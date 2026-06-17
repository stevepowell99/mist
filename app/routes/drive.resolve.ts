import type { Route } from "./+types/drive.resolve";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveGetMeta, driveResolvePath } from "~/lib/google.server";
import { openDriveRequest, canAccessFile, driveForbidden } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";

/**
 * Resolve a source deck's relative image paths to Drive file ids, so a slide
 * picked from another deck ("from a deck" tab) can carry portable `drive:<id>`
 * references instead of relative paths that only resolve in the source. Gated by
 * the caller's access to the source deck. Returns { map: { [path]: id|null } };
 * a path that does not resolve maps to null and is left as-is by the client.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

  let body: { deck?: string; paths?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const deck = (body.deck ?? "").trim();
  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!deck) return json({ error: "deck (file id) required" }, 400);
  if (!(await canAccessFile(env, deck, access.email))) return driveForbidden();
  if (!paths.length) return json({ map: {} });

  try {
    const token = await getDriveAccessToken(env);
    const folder = (await driveGetMeta(token, deck)).parents?.[0];
    const map: Record<string, string | null> = {};
    for (const p of paths) {
      try {
        map[p] = folder ? await driveResolvePath(token, folder, p) : null;
      } catch {
        map[p] = null;
      }
    }
    return json({ map });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "resolve failed" }, 502);
  }
}
