import type { Route } from "./+types/local.git";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { isLocalMode, localGitCommit, localGitInfo } from "~/lib/google.server";
import { isLocalFileId } from "~/lib/localfs-ids";
import { json } from "~/lib/http.server";

/**
 * Commit the open file, and say whether committing it would mean anything.
 *
 * A commit is the one thing that survives every way work has been destroyed in
 * this repo's own history: an agent running `git checkout --` on a working tree
 * it took for its own debris, a session rewind restoring a stale checkpoint, a
 * whole-file write from a copy read hours earlier. None of them can reach an
 * object already in git.
 */
function target(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("id");
  return id && isLocalFileId(id) ? id : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ repo: false, dirty: false, branch: null });
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  const id = target(request);
  if (!id) return json({ repo: false, dirty: false, branch: null });
  try {
    return json(await localGitInfo(env, id));
  } catch {
    return json({ repo: false, dirty: false, branch: null });
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ error: "local mode only" }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  const id = target(request);
  if (!id) return json({ error: "not a local file id" }, 400);
  let message: string | undefined;
  try {
    message = ((await request.json()) as { message?: string }).message;
  } catch {
    message = undefined;
  }
  try {
    return json(await localGitCommit(env, id, message));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "commit failed" }, 500);
  }
}
