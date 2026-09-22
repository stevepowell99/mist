import puppeteer from "@cloudflare/puppeteer";
import type { Route } from "./+types/slides.$id.pdf";
import { getCloudflare } from "~/lib/cloudflare.server";

/**
 * A deck as a real PDF file, printed server-side by headless Chrome (Cloudflare
 * Browser Rendering) from the same `/slides/:id?print-pdf` page the browser's
 * own print used. The result no longer depends on the viewer's browser, print
 * dialog, zoom or how quickly its fonts and images arrived: the page says when
 * it is laid out (`html[data-mist-ready]`, set by the deck runtime) and only then
 * is it printed, at reveal's own `@page` size with backgrounds on.
 *
 * Takes the same `k` / `token` / `combine-fragments` parameters as `/slides/:id`
 * and passes them through, so it is gated exactly as that page is. When the
 * browser cannot be had (the free plan's daily minutes or three concurrent
 * browsers are used up) or the deck never reports ready, it redirects to the
 * browser-print page instead, with the reason in `pdf-fallback` and in the log.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * What the new tab shows while the PDF is made. Rendering takes several seconds,
 * longer when the free plan makes us wait for a browser, and a tab left on its
 * opening blank page looks dead and does nothing on refresh. This page answers
 * at once and then navigates to the `render` URL; the browser keeps it on screen
 * until the PDF arrives.
 */
function waitingPage(renderUrl: string): Response {
  const target = JSON.stringify(renderUrl).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Making PDF…</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.5 system-ui,sans-serif;color:#1F1F36;background:#fafafa}
main{text-align:center;max-width:28em;padding:16px}.s{width:28px;height:28px;margin:0 auto 16px;border:3px solid #ddd;border-top-color:#2a8a86;border-radius:50%;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}small{color:#777}</style></head>
<body><main><div class="s"></div><div>Making the PDF of this deck…</div>
<small><span id="t">0</span> s. Usually under ten seconds, up to thirty when another PDF was made just before. If nothing appears, look in your downloads.</small></main>
<script>var n=0;setInterval(function(){document.getElementById('t').textContent=++n},1000);location.replace(${target});</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const url = new URL(request.url);
  if (!url.searchParams.has("render")) {
    const render = new URL(url);
    render.searchParams.set("render", "1");
    return waitingPage(render.pathname + render.search);
  }
  url.searchParams.delete("render");
  const deck = new URL(`/slides/${params.id}`, url.origin);
  for (const [k, v] of url.searchParams) deck.searchParams.set(k, v);
  deck.searchParams.set("print-pdf", "");

  const fallback = (reason: string) => {
    console.error(`[pdf] ${params.id}: falling back to browser print: ${reason}`);
    deck.searchParams.set("pdf-fallback", reason.slice(0, 120));
    return Response.redirect(deck.toString(), 302);
  };

  // The free plan starts one new browser every 20 seconds, so a second print
  // straight after the first is refused with "Rate limit exceeded". Wait it out
  // rather than falling back; the daily-minutes cap ("time limit") does not clear
  // by waiting, so that one falls back at once.
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  for (let attempt = 0; !browser; attempt++) {
    try {
      browser = await puppeteer.launch(env.BROWSER);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 3 || !/rate limit/i.test(msg)) return fallback(`no browser: ${msg}`);
      await new Promise((r) => setTimeout(r, 7_000));
    }
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const res = await page.goto(deck.toString(), { waitUntil: "networkidle0", timeout: READY_TIMEOUT_MS });
    if (!res || !res.ok()) {
      // Not a rendering fault: the deck page itself refused (bad key, not a deck).
      return new Response(res ? await res.text() : "deck page did not load", { status: res?.status() ?? 502 });
    }
    await page.waitForSelector("html[data-mist-ready]", { timeout: READY_TIMEOUT_MS });
    const ready = await page.$eval("html", (el) => el.getAttribute("data-mist-ready"));
    if (ready !== "1") return fallback(`deck laid out no print pages (${ready})`);
    const title = (await page.title()) || "deck";
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${title.replace(/[^\w.-]+/g, "-")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
  }
}
