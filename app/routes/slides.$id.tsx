import type { Route } from "./+types/slides.$id";
import { isValidDocumentId } from "~/shared/constants";
import { isLocalFileId } from "~/lib/localfs-ids";
import { resolveDoc } from "~/lib/doc-resolve.server";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveRead, driveConfigured } from "~/lib/google.server";
import { buildSlidesHtml, extractBibPaths } from "~/lib/slides-build";
import { findBibText } from "~/lib/bib.server";
import { parseBib, type BibLibrary } from "~/lib/citations";
import { rawFrontmatter } from "~/lib/thread-serialization";
import { stripMistBanner } from "~/shared/mist-banner";
import type { DocRole, DriveMeta } from "~/shared/types";

/**
 * Standalone deck page, built server-side from the backend source, for printing
 * to PDF: open with `?print-pdf` and reveal lays the deck out one slide per page
 * for the browser's Save as PDF. Add `&combine-fragments` to print one page per
 * slide (fragments collapsed) instead of one page per animation step. Authorised
 * by the doc's secret key; Drive asset links carry a signed asset token so the
 * printed deck keeps its css/images.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id) && !isLocalFileId(id)) return new Response("not found", { status: 404 });

  const url = new URL(request.url);
  const docKey = url.searchParams.get("k") ?? "";
  const token = url.searchParams.get("token") ?? "";
  // `combine-fragments` collapses each slide's animation steps onto one PDF page
  // (one page per slide) instead of reveal's default page-per-fragment.
  const separateFragments = !url.searchParams.has("combine-fragments");

  const { env } = getCloudflare(context);
  const { role, drive } = await resolveDoc(env, id, docKey);
  if (!role) return new Response("forbidden", { status: 403 });

  try {
    if (!drive) return new Response("document is not a deck", { status: 400 });
    if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });
    const t = await getDriveAccessToken(env);
    const source = (await driveRead(t, drive.fileId)).text;

    // The deck's citations resolve here, server-side, because a public viewer has
    // no session to fetch /drive/bib with. A failed lookup renders the deck with
    // its citation keys unresolved rather than failing the page.
    let bibLib: BibLibrary | null = null;
    try {
      const bib = drive.folderId
        ? await findBibText(env, t, drive.folderId, extractBibPaths(rawFrontmatter(source)))
        : "";
      if (bib.trim()) bibLib = parseBib(bib);
      else console.log(`[slides] ${id}: no bibliography found (folder ${drive.folderId ?? "unknown"})`);
    } catch (err) {
      console.error(`[slides] ${id}: bibliography lookup failed: ${err instanceof Error ? err.message : err}`);
    }

    const html = buildSlidesHtml(stripMistBanner(source), {
      drive,
      origin: url.origin,
      driveToken: token,
      bust: "print",
      docFrontmatter: "",
      pdfSeparateFragments: separateFragments,
      bibLib,
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "failed to build deck", { status: 502 });
  }
}
