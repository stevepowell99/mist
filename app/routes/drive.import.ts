import type { Route } from "./+types/drive.import";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest, driveForbidden } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";
import { importDriveFileToRoom } from "~/lib/drive-import.server";

/**
 * Open a Google Drive markdown file into a new mist document, seeded from the
 * file's current content and bound to it for write-back. The import core is
 * shared with the GET /open deep-link route (see drive-import.server.ts); this
 * route is the in-app POST path (quick-open / sidebar).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

  let payload: { url?: string };
  try {
    payload = (await request.json()) as { url?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  const result = await importDriveFileToRoom(env, payload.url, access.email);
  if (!result.ok) {
    if (result.status === 403) return driveForbidden();
    return json({ error: result.error }, result.status);
  }
  return json({ url: result.url }, 201);
}
