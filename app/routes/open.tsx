import type { Route } from "./+types/open";
import { redirect, data } from "react-router";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { importDriveFileToRoom } from "~/lib/drive-import.server";
import { isLocalMode, resolveLocalFilePath } from "~/lib/google.server";
import DocGate from "~/components/DocGate";

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
 * Add `&share=suggest` (or `edit`) to have the room copy its own share link to
 * the clipboard on arrival, so an external tool gets a link to paste without
 * holding any gmist credentials of its own. See ShareOnOpen.
 *
 * Import is the same core as POST /drive/import. Auth is the signed-in browser
 * session (bypassed in local mode), so the launching tool needs no credentials.
 * A caller who is not signed in, or not shared on the file, gets the same gate
 * screen /docs/:id shows; this route used to answer a bare JSON 401, which reads
 * as a broken link to whoever was sent it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) {
    if (gate.error.status === 401) return { gate: "needsAuth" as const };
    return gate.error;
  }

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

  // Local mode has no rooms. The id IS the file, so opening it is a redirect
  // and nothing is created: open the same file twice and you are simply in the
  // same editor on the same file, the way any other editor behaves.
  if (isLocalMode(env)) return redirect(`/docs/${encodeURIComponent(fileId)}`);

  const result = await importDriveFileToRoom(env, fileId, gate.access.email);
  if (!result.ok) {
    if (result.status === 403) return { gate: "forbidden" as const };
    throw data(result.error, { status: result.status });
  }

  // The room URL already carries ?k=, so share rides along as a second param.
  const share = url.searchParams.get("share");
  return redirect(share === null ? result.url : `${result.url}&share=${encodeURIComponent(share)}`);
}

export default function OpenPage({ loaderData }: Route.ComponentProps) {
  const kind = loaderData && "gate" in loaderData ? loaderData.gate : "needsAuth";
  return <DocGate kind={kind} />;
}
