/**
 * One source for the image/asset MIME tables, shared by the upload routes (which
 * need a file extension for an uploaded image's content type) and the asset proxy
 * (which needs a content type for a served file's extension).
 */

/** File extension for an uploaded image's MIME type. */
export const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Content-Type for a served file's extension (assets streamed by /drive/asset). */
const MIME_BY_EXT: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

/** The content type for a path, by its extension, or a generic binary fallback. */
export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
