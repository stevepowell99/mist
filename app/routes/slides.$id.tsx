import type { Route } from "./+types/slides.$id";
import { isValidDocumentId } from "~/shared/constants";
import { isLocalFileId } from "~/lib/localfs-ids";
import { resolveDoc, readRoomSource } from "~/lib/doc-resolve.server";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveRead, driveConfigured } from "~/lib/google.server";
import { buildSlidesHtml } from "~/lib/slides-build";
import { bibForSource } from "~/lib/bib.server";
import { parseBib } from "~/lib/citations";
import { stripMistBanner } from "~/shared/mist-banner";
import { mintAssetTokenForDoc, type DriveSessionEnv } from "~/lib/drive-access.server";

/**
 * Standalone deck page, built server-side from the backend source, for printing
 * to PDF: open with `?print-pdf` and reveal lays the deck out one slide per page
 * for the browser's Save as PDF. Add `&combine-fragments` to print one page per
 * slide (fragments collapsed) instead of one page per animation step. Authorised
 * by the doc's secret key. The page mints its own asset token for the deck's
 * css and images once the key checks out, so a link needs only `?k=`, never goes
 * stale, and local gmist's print (which opens this page with no token) keeps its
 * pictures. A `token` in the URL is ignored.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id) && !isLocalFileId(id)) return new Response("not found", { status: 404 });

  const url = new URL(request.url);
  const docKey = url.searchParams.get("k") ?? "";
  // `combine-fragments` collapses each slide's animation steps onto one PDF page
  // (one page per slide) instead of reveal's default page-per-fragment.
  const separateFragments = !url.searchParams.has("combine-fragments");

  const { env } = getCloudflare(context);
  const { role, drive } = await resolveDoc(env, id, docKey);
  if (!role) return new Response("forbidden", { status: 403 });
  const token = (await mintAssetTokenForDoc(env as unknown as DriveSessionEnv, true)) ?? "";

  try {
    // A shared room has no file: its text comes from the room, with no .bib.
    let source: string;
    let bib = "";
    if (drive) {
      if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });
      const t = await getDriveAccessToken(env);
      source = (await driveRead(t, drive.fileId)).text;
      bib = await bibForSource(env, t, drive, source, id);
    } else {
      source = await readRoomSource(env, id, docKey);
    }
    const bibLib = bib.trim() ? parseBib(bib) : null;

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
