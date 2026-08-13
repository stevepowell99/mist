import type { Route } from "./+types/drive.asset";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  getDriveAccessToken,
  driveGetMeta,
  driveResolvePath,
  driveDownload,
} from "~/lib/google.server";
import { openDriveRequest, canAccessFile, driveForbidden } from "~/lib/drive-access.server";
import { isInLibrary, type LibraryEnv } from "~/lib/library.server";
import { mimeForPath } from "~/lib/mime";

/**
 * Stream a deck's relative asset (CSS, image, font) from Drive through the relay
 * identity, so the slides iframe can load private-Drive resources that have no
 * public URL. The path is resolved against the deck file's own folder.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

  // id-mode: a shared-library image by Drive id, so the same image is reusable
  // across decks. Two MANDATORY constraints keep this from being a read-any-file
  // endpoint for any session/token holder: the file must be an image, and must
  // live inside the configured library subtree.
  const id = url.searchParams.get("id");
  if (id) {
    try {
      const token = await getDriveAccessToken(env);
      const meta = await driveGetMeta(token, id);
      const mime = mimeForPath(meta.name);
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
    // Resolve against the document's own folder first. Obsidian, though, writes an
    // embed's path from the VAULT root ("001 Working Papers/img/x.jpg"), which is
    // not a path from the note's folder, so retry from each parent folder up the
    // tree: whichever ancestor the vault root is, one of these hits it. Bounded, so
    // a genuinely missing image still 404s quickly.
    //
    // A bare filename (`![[INTRAC MAP.png]]`, Obsidian's embed, which resolves by
    // basename across the whole vault) also gets the usual picture folders tried
    // beneath each of those folders. `img/` is first because that is where this
    // app puts a pasted image, so what gmist writes is what gmist can find.
    const attachmentDirs = ["img", "attachments", "assets", "media"];
    const candidates = path.includes("/") ? [path] : [path, ...attachmentDirs.map((d) => `${d}/${path}`)];
    let fileId: string | null = null;
    let base: string | null = folder;
    for (let up = 0; up <= 3 && base && !fileId; up++) {
      for (const candidate of candidates) {
        try {
          fileId = await driveResolvePath(token, base, candidate);
        } catch {
          fileId = null; // not under this folder; try the next candidate, then the parent
        }
        if (fileId) break;
      }
      if (!fileId) base = (await driveGetMeta(token, base)).parents?.[0] ?? null;
    }
    if (!fileId) return new Response("asset not found", { status: 404 });
    const body = await driveDownload(token, fileId);
    return new Response(body, {
      headers: {
        "Content-Type": mimeForPath(path),
        // Short cache: edited stylesheets should reappear without a long wait.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "asset failed", { status: 502 });
  }
}
