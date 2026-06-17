/**
 * Resolve relative asset paths (images) to loadable URLs for a Drive document
 * (the /drive/asset proxy). Shared by the slides view and the document preview
 * so both resolve images the same way.
 */
import type { DriveMeta } from "~/shared/types";

/** /drive/asset proxy URL for a deck/doc-relative path; token rides as a query
 *  param since iframe/img tags cannot set a header. */
export function driveAssetUrl(drive: DriveMeta, origin: string, relPath: string, token: string): string {
  // Encode each path segment but keep literal "/" separators. The full reveal.js
  // markdown renderer re-encodes URLs in slide content, so an escaped "%2F"
  // becomes "%252F" and the proxy can no longer split the path. Real slashes
  // survive that pass untouched.
  const encPath = relPath.split("/").map(encodeURIComponent).join("/");
  return `${origin}/drive/asset?deck=${encodeURIComponent(drive.fileId)}&path=${encPath}&token=${encodeURIComponent(token)}`;
}

export interface AssetCtx {
  drive: DriveMeta | null;
  origin: string;
  driveToken: string;
}

/** Resolve one src; absolute, root-relative and data URLs pass through. A
 *  `drive:<fileId>` reference (a shared-library image) resolves by id, so it is
 *  portable across decks regardless of folder; relative paths resolve against the
 *  deck's own folder as before. */
export function resolveAssetSrc(path: string, ctx: AssetCtx): string {
  if (/^https?:\/\//.test(path) || path.startsWith("/") || path.startsWith("data:")) return path;
  const driveId = path.match(/^drive:(.+)$/);
  if (driveId && ctx.driveToken) {
    return `${ctx.origin}/drive/asset?id=${encodeURIComponent(driveId[1])}&token=${encodeURIComponent(ctx.driveToken)}`;
  }
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
