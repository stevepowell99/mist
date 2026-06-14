/**
 * Resolve relative asset paths (images) to loadable URLs for whichever backend
 * a document came from: GitHub (raw URL) or Drive (the /drive/asset proxy).
 * Shared by the slides view and the document preview so both resolve images the
 * same way.
 */
import type { DriveMeta, GitHubMeta } from "~/shared/types";
import { resolveImageSrc } from "~/lib/github";

/** /drive/asset proxy URL for a deck/doc-relative path; token rides as a query
 *  param since iframe/img tags cannot set a header. */
export function driveAssetUrl(drive: DriveMeta, origin: string, relPath: string, token: string): string {
  return `${origin}/drive/asset?deck=${encodeURIComponent(drive.fileId)}&path=${encodeURIComponent(relPath)}&token=${encodeURIComponent(token)}`;
}

export interface AssetCtx {
  github: GitHubMeta | null;
  drive: DriveMeta | null;
  origin: string;
  driveToken: string;
}

/** Resolve one src; absolute, root-relative and data URLs pass through. */
export function resolveAssetSrc(path: string, ctx: AssetCtx): string {
  if (/^https?:\/\//.test(path) || path.startsWith("/") || path.startsWith("data:")) return path;
  if (ctx.github) return resolveImageSrc(path, ctx.github) ?? path;
  if (ctx.drive && ctx.driveToken) return driveAssetUrl(ctx.drive, ctx.origin, path, ctx.driveToken);
  return path;
}

/** Rewrite every `![alt](src "title")` so relative srcs resolve for the backend. */
export function rewriteImages(md: string, ctx: AssetCtx): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (_m, alt: string, url: string, title: string) => `![${alt}](${resolveAssetSrc(url, ctx)}${title})`,
  );
}
