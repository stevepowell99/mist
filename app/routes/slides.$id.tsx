import type { Route } from "./+types/slides.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveRead, driveConfigured } from "~/lib/google.server";
import { buildSlidesHtml } from "~/lib/slides-build";
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
  if (!isValidDocumentId(id)) return new Response("not found", { status: 404 });

  const url = new URL(request.url);
  const docKey = url.searchParams.get("k") ?? "";
  const token = url.searchParams.get("token") ?? "";
  // `combine-fragments` collapses each slide's animation steps onto one PDF page
  // (one page per slide) instead of reveal's default page-per-fragment.
  const separateFragments = !url.searchParams.has("combine-fragments");

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request(`https://do/?k=${encodeURIComponent(docKey)}`));
  const { role, drive } = (await res.json()) as {
    role: DocRole | null;
    drive: DriveMeta | null;
  };
  if (!role) return new Response("forbidden", { status: 403 });

  try {
    let source: string;
    if (drive) {
      if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });
      const t = await getDriveAccessToken(env);
      source = (await driveRead(t, drive.fileId)).text;
    } else {
      return new Response("document is not a deck", { status: 400 });
    }

    const html = buildSlidesHtml(stripMistBanner(source), {
      drive,
      origin: url.origin,
      driveToken: token,
      bust: "print",
      docFrontmatter: "",
      pdfSeparateFragments: separateFragments,
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "failed to build deck", { status: 502 });
  }
}
