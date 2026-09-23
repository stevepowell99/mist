import puppeteer from "@cloudflare/puppeteer";

/**
 * A print page as a real PDF file, printed server-side by headless Chrome
 * (Cloudflare Browser Rendering). Decks (`/slides/:id?print-pdf`) and documents
 * (`/print/:id`) both come through here, so the two differ only in which page is
 * printed. The result does not depend on the viewer's browser, print dialog,
 * zoom or how quickly its fonts and images arrived: the page says when it is laid
 * out (`html[data-mist-ready="1"]`) and only then is it printed, at the page's
 * own `@page` size with backgrounds on.
 *
 * When no browser can be had (the free plan's daily minutes or three concurrent
 * browsers are used up) or the page never reports ready, it redirects to the
 * browser-print page instead, with the reason in `pdf-fallback` and in the log.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * What the new tab shows while the PDF is made. Rendering takes several seconds,
 * longer when the free plan makes us wait for a browser, and a tab left on its
 * opening blank page looks dead and does nothing on refresh. This page answers
 * at once, then fetches the `render` URL itself and saves the result as a
 * download. It must not navigate there: a PDF viewer (Chrome's, Electron's, or
 * a PDF extension) fetches a navigated PDF a second time, which here means a
 * second headless browser behind the free plan's one-per-20s launch limit, and
 * the viewer showed an empty "0 of 0" document while it waited. A fallback
 * redirect arrives as HTML, so the page follows it to the browser-print view.
 */
function waitingPage(renderUrl: string, noun: string): Response {
  const target = JSON.stringify(renderUrl).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Making PDF…</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.5 system-ui,sans-serif;color:#1F1F36;background:#fafafa}
main{text-align:center;max-width:28em;padding:16px}.s{width:28px;height:28px;margin:0 auto 16px;border:3px solid #ddd;border-top-color:#2a8a86;border-radius:50%;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}small{color:#777}</style></head>
<body><main><div class="s"></div><div>Making the PDF of this ${noun}…</div>
<small><span id="t">0</span> s. Usually under ten seconds, up to thirty when another PDF was made just before. If nothing appears, look in your downloads.</small></main>
<script>var n=0,tick=setInterval(function(){document.getElementById('t').textContent=++n},1000);
fetch(${target},{credentials:'same-origin'}).then(function(r){
if(!/application\\/pdf/.test(r.headers.get('Content-Type')||'')){location.replace(r.url);return;}
var m=/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition')||'');
return r.blob().then(function(b){clearInterval(tick);var u=URL.createObjectURL(b),a=document.createElement('a');
a.href=u;a.download=m?m[1]:'${noun}.pdf';document.body.appendChild(a);a.click();
document.querySelector('main').innerHTML='<div>Saved to your downloads as '+a.download.replace(/</g,'&lt;')+'.</div><small><a href="'+u+'" target="_blank">Open it here</a></small>';});
}).catch(function(e){clearInterval(tick);document.querySelector('main').textContent='Could not make the PDF: '+e;});</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export interface PrintPdfOptions {
  env: Env;
  /** The incoming request: without `render` it gets the waiting page, with it the PDF. */
  request: Request;
  /** The page headless Chrome prints. */
  page: URL;
  /** Where the viewer's own browser goes when the server cannot print. */
  fallback: URL;
  /** "deck" or "document", for the waiting page and the default file name. */
  noun: string;
  /** For the log. */
  label: string;
  viewport: { width: number; height: number };
  /** Puppeteer footer template (its `pageNumber` / `totalPages` classes), drawn
   *  in the bottom page margin. The server's Chrome does not draw CSS margin
   *  boxes, so this is the only way a page number gets onto its PDF. */
  footer?: string;
}

export async function printPdf(o: PrintPdfOptions): Promise<Response> {
  const url = new URL(o.request.url);
  if (!url.searchParams.has("render")) {
    url.searchParams.set("render", "1");
    return waitingPage(url.pathname + url.search, o.noun);
  }

  const fallback = (reason: string) => {
    console.error(`[pdf] ${o.label}: falling back to browser print: ${reason}`);
    o.fallback.searchParams.set("pdf-fallback", reason.slice(0, 120));
    return Response.redirect(o.fallback.toString(), 302);
  };

  // The free plan starts one new browser every 20 seconds, so a second print
  // straight after the first is refused with "Rate limit exceeded". Wait it out
  // rather than falling back; the daily-minutes cap ("time limit") does not clear
  // by waiting, so that one falls back at once.
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  for (let attempt = 0; !browser; attempt++) {
    try {
      browser = await puppeteer.launch(o.env.BROWSER);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 3 || !/rate limit/i.test(msg)) return fallback(`no browser: ${msg}`);
      await new Promise((r) => setTimeout(r, 7_000));
    }
  }
  try {
    const page = await browser.newPage();
    await page.setViewport(o.viewport);
    const res = await page.goto(o.page.toString(), { waitUntil: "networkidle0", timeout: READY_TIMEOUT_MS });
    if (!res || !res.ok()) {
      // Not a rendering fault: the print page itself refused (bad key, no access).
      return new Response(res ? await res.text() : "print page did not load", { status: res?.status() ?? 502 });
    }
    await page.waitForSelector("html[data-mist-ready]", { timeout: READY_TIMEOUT_MS });
    const ready = await page.$eval("html", (el) => el.getAttribute("data-mist-ready"));
    if (ready !== "1") return fallback(`page laid out nothing to print (${ready})`);
    const title = (await page.title()) || o.noun;
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      // An empty header, or Chrome prints its own date and title there.
      ...(o.footer ? { displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: o.footer } : {}),
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // The waiting page fetches this and saves it (see waitingPage); attachment
        // keeps a direct visit a download too.
        "Content-Disposition": `attachment; filename="${title.replace(/[^\w.-]+/g, "-")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
  }
}
