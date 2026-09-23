import { useEffect, useMemo, useRef, useState } from "react";
import { data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/print.$id";
import { isValidDocumentId } from "~/shared/constants";
import { isLocalFileId } from "~/lib/localfs-ids";
import { resolveDoc } from "~/lib/doc-resolve.server";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveRead, driveConfigured } from "~/lib/google.server";
import { authorizeDoc, mintAssetTokenForDoc, type DriveSessionEnv } from "~/lib/drive-access.server";
import { verifyAssetToken } from "~/lib/session.server";
import { bibForSource } from "~/lib/bib.server";
import { parseBib } from "~/lib/citations";
import { renderDocumentHtml } from "~/lib/render-document";
import { runMermaid } from "~/lib/mermaid";
import { POS_ANCHOR_CSS } from "~/lib/source-anchors";
import { themeCss } from "~/lib/themes";
import { rawFrontmatter } from "~/lib/thread-serialization";
import { fileTitle, pdfTitle } from "~/lib/slides-build";

/**
 * A document as A4 pages, for printing: the deck's `/slides/:id?print-pdf`,
 * for a document. It renders through the same chain as the preview, so a printed
 * document reads as the preview does, and Chrome paginates it from the `@page`
 * rules below, the running title and page numbers included. The server's
 * `/print/:id/pdf` prints it with headless Chrome; `?autoprint` has the viewer's
 * own browser open its print dialog instead, which is what local gmist does and
 * where the server falls back to.
 *
 * It sets `html[data-mist-ready="1"]` once diagrams, images and fonts are in,
 * the same signal the deck page gives, which is what the PDF route waits for.
 *
 * The secret key alone is not enough to read a document, unlike a deck's public
 * view, so there are two ways in: a signed-in viewer the file's Drive sharing
 * admits, or the short-lived asset token the PDF route gives the headless
 * browser, which has no session.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id) && !isLocalFileId(id)) throw data("Not found.", { status: 404 });
  const url = new URL(request.url);
  const { env } = getCloudflare(context);
  const sessionEnv = env as unknown as DriveSessionEnv;

  const { role, drive } = await resolveDoc(env, id, url.searchParams.get("k") ?? "");
  if (!role) throw data("Not found.", { status: 404 });
  if (!drive) throw data("This document has no file to print.", { status: 400 });
  if (!(await verifyAssetToken(url.searchParams.get("token"), sessionEnv.SESSION_SECRET ?? ""))) {
    const auth = await authorizeDoc(sessionEnv, request, drive, role);
    if (auth.status === "needsAuth") throw data("Sign in to gmist to print this document.", { status: 401 });
    if (auth.status !== "ok") throw data("You do not have access to this file.", { status: 403 });
  }
  if (!driveConfigured(env)) throw data("Drive is not configured.", { status: 501 });

  const t = await getDriveAccessToken(env);
  const markdown = (await driveRead(t, drive.fileId)).text;
  return {
    markdown,
    drive,
    bib: await bibForSource(env, t, drive, markdown, id),
    // For the images: headless Chrome fetches them with this, having no session.
    assetToken: (await mintAssetTokenForDoc(sessionEnv, true)) ?? "",
    heading: fileTitle(drive, ""),
    pdfName: pdfTitle(drive.name),
  };
}

/** The page <title> names the PDF, in the server's download and in Save as PDF. */
export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: d?.pdfName ?? "gmist" }];
}

/**
 * The page: A4, the document's name at the head of every page but the first,
 * and "n / m" at the foot. Chrome draws these margin boxes itself, in a viewer's
 * print and in the headless one alike, so nothing has to paginate by script.
 * Georgia is not on the Linux the server prints on, so Gelasio, drawn to
 * Georgia's metrics, stands in for it there and is never reached on Windows.
 * A themed document still prints dark ink on white paper.
 */
function printCss(heading: string): string {
  const safe = heading.replace(/["\\\r\n]/g, "");
  const running = "font: 9pt Georgia, Gelasio, serif; color: #9aa0a6;";
  return `@import url("https://fonts.googleapis.com/css2?family=Gelasio:ital,wght@0,400;0,700;1,400;1,700&display=swap");
@page {
  size: A4;
  margin: 20mm 18mm 18mm;
  @top-left { content: "${safe}"; ${running} }
  @bottom-right { content: counter(page) " / " counter(pages); ${running} }
}
@page :first { @top-left { content: none; } }
:root { --font-serif: "Georgia", "Gelasio", "Times New Roman", ui-serif, serif; }
html, body { background: #fff; }
.preview.print-doc { max-width: none; margin: 0; padding: 0; font-size: 11.5pt; line-height: 1.5; color: #111; background: #fff; }
.print-doc h1, .print-doc h2, .print-doc h3, .print-doc h4 { break-after: avoid; }
.print-doc pre, .print-doc table, .print-doc blockquote, .print-doc figure, .print-doc img, .print-doc .mermaid { break-inside: avoid; }
.print-doc img { max-width: 100%; height: auto; }
@media screen {
  html, body { background: #525659; }
  .preview.print-doc { box-sizing: border-box; width: min(210mm, 100%); min-height: 297mm; margin: 24px auto; padding: 20mm 18mm 18mm; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
}`;
}

/** Every image in `root` loaded or failed, so a page is never printed around a gap. */
function imagesSettled(root: HTMLElement | null): Promise<unknown> {
  const waiting = Array.from(root?.querySelectorAll("img") ?? []).filter((img) => !img.complete);
  return Promise.all(
    waiting.map(
      (img) =>
        new Promise((done) => {
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }),
    ),
  );
}

export default function PrintPage({ loaderData }: Route.ComponentProps) {
  const { markdown, drive, bib, assetToken, heading } = loaderData;
  const container = useRef<HTMLDivElement>(null);

  // DOMPurify needs a DOM, which the Worker has none of, so the render waits for
  // hydration, exactly as the previews do.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect

  const html = useMemo(
    () =>
      !mounted
        ? ""
        : renderDocumentHtml(markdown, {
            drive,
            origin: window.location.origin,
            driveToken: assetToken,
            bibLib: bib.trim() ? parseBib(bib) : null,
          }),
    [mounted, markdown, drive, assetToken, bib],
  );
  const inner = useMemo(() => ({ __html: html }), [html]);
  const theme = useMemo(() => themeCss(rawFrontmatter(markdown)), [markdown]);

  useEffect(() => {
    if (!mounted) return;
    // Paper is white whatever the viewer's app theme.
    document.documentElement.setAttribute("data-theme", "light");
    let stale = false;
    void (async () => {
      await runMermaid(container.current);
      await imagesSettled(container.current);
      await document.fonts.ready;
      if (stale) return;
      document.documentElement.setAttribute("data-mist-ready", "1");
      if (new URLSearchParams(window.location.search).has("autoprint")) window.print();
    })();
    return () => {
      stale = true;
    };
  }, [mounted, html]);

  // Each sheet is its own <style>, because an @import only counts at the top of one.
  return (
    <>
      <style>{theme}</style>
      <style>{printCss(heading)}</style>
      <style>{POS_ANCHOR_CSS}</style>
      <div ref={container} className="preview print-doc font-serif" dangerouslySetInnerHTML={inner} />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error) ? String(error.data) : "This document could not be printed.";
  return <main className="flex min-h-screen items-center justify-center p-4 text-muted">{message}</main>;
}
