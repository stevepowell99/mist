import type { Route } from "./+types/open";
import { redirect, data } from "react-router";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { importDriveFileToRoom } from "~/lib/drive-import.server";
import { isLocalMode, resolveLocalFilePath } from "~/lib/google.server";

/**
 * Direct deep-link to open a markdown file in gmist, from an external tool that
 * already knows which file (e.g. TagFox), then redirect straight into the room.
 * Two forms, matching the two storage modes:
 *
 *  - GET /open?file=<Drive id or URL> — Drive mode.
 *  - GET /open?path=<absolute path>   — local mode: the sidecar resolves the
 *    path to an id first (it owns the id scheme and refuses non-markdown or a
 *    path it cannot read). This is the local counterpart, so TagFox can hand
 *    over any local file, not only one under a Drive mount.
 *
 * Import is the same core as POST /drive/import. Auth is the signed-in browser
 * session (bypassed in local mode), so the launching tool needs no credentials.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const url = new URL(request.url);
  const localPath = url.searchParams.get("path");
  let fileId = url.searchParams.get("file");

  if (localPath) {
    if (!isLocalMode(env)) throw data("?path= is only available in local mode; use ?file=", { status: 400 });
    const resolved = await resolveLocalFilePath(env, localPath);
    if (!resolved) throw data(`could not open "${localPath}" (missing, a folder, or not .md/.qmd)`, { status: 404 });
    fileId = resolved.id;
  }
  if (!fileId) throw data("missing ?file= (a Drive file id or URL) or ?path= (a local absolute path)", { status: 400 });

  const result = await importDriveFileToRoom(env, fileId, gate.access.email);
  if (!result.ok) throw data(result.error, { status: result.status });
  return redirect(result.url);
}
