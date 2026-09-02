import type { Route } from "./+types/local.doc";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { driveRead, driveWrite, getDriveAccessToken, isLocalMode } from "~/lib/google.server";
import { isLocalFileId } from "~/lib/localfs-ids";
import { json } from "~/lib/http.server";

/**
 * Read and write one local file. In local mode this is the whole document
 * protocol, and it is deliberately this small.
 *
 * There is no room, no server-side copy of the content and nothing to
 * reconcile. The browser holds the editor buffer, the file holds the document,
 * and a write carries the version the browser loaded, so a file that changed
 * underneath is refused rather than overwritten. That refusal is the only
 * conflict state there is.
 */
function target(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("id");
  return id && isLocalFileId(id) ? id : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ error: "local mode only" }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  const id = target(request);
  if (!id) return json({ error: "not a local file id" }, 400);
  try {
    const { text, version } = await driveRead(await getDriveAccessToken(env), id);
    return json({ text, version });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "read failed" }, 404);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ error: "local mode only" }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  const id = target(request);
  if (!id) return json({ error: "not a local file id" }, 400);

  // The version the browser loaded or last wrote. Absent means "write anyway",
  // which only a deliberate overwrite should ever ask for.
  const expected = new URL(request.url).searchParams.get("expected");
  const content = await request.text();
  try {
    const { version } = await driveWrite(await getDriveAccessToken(env), id, content, expected);
    return json({ version });
  } catch (err) {
    const message = err instanceof Error ? err.message : "write failed";
    if (/changed upstream/.test(message)) return json({ error: message }, 409);
    return json({ error: message }, 502);
  }
}
