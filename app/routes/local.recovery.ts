import type { Route } from "./+types/local.recovery";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { driveGetMeta, driveWrite, getDriveAccessToken, isLocalMode } from "~/lib/google.server";
import { idToPath, isLocalFileId, pathToId } from "~/lib/localfs-ids";
import { json } from "~/lib/http.server";

/**
 * Keep a copy of the editor's buffer beside the file, before anything replaces
 * it.
 *
 * The only moment a local editor is allowed to discard what somebody typed is
 * when they ask it to, by taking the version on disk over their own. Even then
 * it should not actually be discarded: the earlier local build replaced the
 * buffer with no copy at all, and a morning went that way on 8 September 2026.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ error: "local mode only" }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !isLocalFileId(id)) return json({ error: "not a local file id" }, 400);

  const path = idToPath(id);
  if (!path) return json({ error: "not a local file id" }, 400);

  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : ".md";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const target = `${base} (unsaved ${stamp})${ext}`;

  try {
    const token = await getDriveAccessToken(env);
    // No expected version: this is a new file beside the document, and there is
    // nothing it could be clobbering.
    await driveWrite(token, pathToId(target), await request.text());
    const meta = await driveGetMeta(token, pathToId(target));
    return json({ saved: meta.name });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "could not save a copy" }, 502);
  }
}
