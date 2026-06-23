import type { Route } from "./+types/open";
import { redirect, data } from "react-router";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { importDriveFileToRoom } from "~/lib/drive-import.server";

/**
 * Direct deep-link to open a Google Drive markdown file in gmist by its Drive
 * file id (or a Drive file URL): GET /open?file=<id>. Imports the file into a
 * fresh room (the same core as POST /drive/import) and redirects straight into
 * it. Used by external tools that already hold the Drive file id, e.g. TagFox,
 * which reads it from the Drive-for-Desktop file stream. Auth is the signed-in
 * browser session, so the launching tool needs no gmist credentials.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const file = new URL(request.url).searchParams.get("file");
  if (!file) throw data("missing ?file= (a Drive file id or URL)", { status: 400 });

  const result = await importDriveFileToRoom(env, file, gate.access.email);
  if (!result.ok) throw data(result.error, { status: result.status });
  return redirect(result.url);
}
