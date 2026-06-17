import type { Route } from "./+types/drive.asset";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveGetMeta,
  driveResolvePath,
  driveDownload,
} from "~/lib/google.server";
import { driveAccess, canAccessFile, driveUnauthenticated, driveForbidden } from "~/lib/drive-access.server";
import { isInLibrary, type LibraryEnv } from "~/lib/library.server";

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
  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const access = await driveAccess(request, env);
  if (!access.ok) return driveUnauthenticated();
  if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });

  // id-mode: a shared-library image by Drive id, so the same image is reusable
  // across decks. Two MANDATORY constraints keep this from being a read-any-file
  // endpoint for any session/token holder: the file must be an image, and must
  // live inside the configured library subtree.
  const id = url.searchParams.get("id");
  if (id) {
    try {
      const token = await getDriveAccessToken(env);
      const meta = await driveGetMeta(token, id);
      const mime = mimeFor(meta.name);
      if (!mime.startsWith("image/")) return new Response("not a library image", { status: 403 });
      if (!(await isInLibrary(token, env, id))) return driveForbidden();
      const body = await driveDownload(token, id);
      return new Response(body, {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=300" },
      });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "asset failed", { status: 502 });
    }
  }

  // path-mode: a deck-relative asset (CSS/image/font) resolved against the deck's
  // own folder, gated by the viewer's access to that deck.
  const deck = url.searchParams.get("deck");
  const path = url.searchParams.get("path");
  if (!deck || !path) return new Response("missing deck or path", { status: 400 });
  if (!(await canAccessFile(env, deck, access.email))) return driveForbidden();

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
