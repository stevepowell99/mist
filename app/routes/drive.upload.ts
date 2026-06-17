import type { Route } from "./+types/drive.upload";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  getDriveAccessToken,
  driveGetMeta,
  driveCreateBinary,
  driveEnsureSubfolder,
} from "~/lib/google.server";
import { openDriveRequest, canAccessFile, driveForbidden } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";
import { EXT_BY_MIME } from "~/lib/mime";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload a pasted image into an `img/` folder beside the document and return
 * the `img/name` path, which the editor inserts as `![](img/name)`. The doc's
 * folder is resolved server-side (the client never names a folder); the img
 * subfolder is created on first use. The /drive/asset proxy serves it back,
 * resolving the doc-folder-relative path.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

  const deck = new URL(request.url).searchParams.get("deck");
  if (!deck) return json({ error: "deck (file id) required" }, 400);
  if (!(await canAccessFile(env, deck, access.email))) return driveForbidden();

  const mime = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!mime.startsWith("image/")) return json({ error: "only image uploads are allowed" }, 415);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "empty upload" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "image too large (max 10 MB)" }, 413);

  try {
    const token = await getDriveAccessToken(env);
    const meta = await driveGetMeta(token, deck);
    const folder = meta.parents?.[0];
    if (!folder) return json({ error: "document has no folder" }, 404);
    const imgFolder = await driveEnsureSubfolder(token, folder, "img");
    const ext = EXT_BY_MIME[mime] ?? "png";
    const name = `pasted-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}.${ext}`;
    await driveCreateBinary(token, imgFolder, name, mime, bytes);
    return json({ path: `img/${name}` }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "upload failed" }, 502);
  }
}
