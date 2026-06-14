import type { Route } from "./+types/drive.asset";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveGetMeta,
  driveResolvePath,
  driveDownload,
} from "~/lib/google.server";

const MIME: Record<string, string> = {
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

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * Stream a deck's relative asset (CSS, image, font) from Drive through the relay
 * identity, so the slides iframe can load private-Drive resources that have no
 * public URL. The path is resolved against the deck file's own folder.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const deck = url.searchParams.get("deck");
  const path = url.searchParams.get("path");
  if (!deck || !path) return new Response("missing deck or path", { status: 400 });

  const { env } = getCloudflare(context);
  if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });

  try {
    const token = await getDriveAccessToken(env);
    const meta = await driveGetMeta(token, deck);
    const folder = meta.parents?.[0];
    if (!folder) return new Response("deck has no folder", { status: 404 });
    const fileId = await driveResolvePath(token, folder, path);
    if (!fileId) return new Response("asset not found", { status: 404 });
    const body = await driveDownload(token, fileId);
    return new Response(body, {
      headers: {
        "Content-Type": mimeFor(path),
        // Short cache: edited stylesheets should reappear without a long wait.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "asset failed", { status: 502 });
  }
}
