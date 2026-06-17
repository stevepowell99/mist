import type { Route } from "./+types/drive.library-upload";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveCreateBinary } from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";
import { EXT_BY_MIME } from "~/lib/mime";
import { getLibraryFolders, type LibraryEnv } from "~/lib/library.server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload an image into the library's `images/` folder, so the gallery grows from
 * inside gmist. Gated by a signed-in session; the destination is the configured
 * library, resolved server-side (the client cannot pick an arbitrary folder).
 * The original filename is kept (sanitised) so the library stays human-curated.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const mime = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!mime.startsWith("image/")) return json({ error: "only image uploads are allowed" }, 415);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "empty upload" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "image too large (max 10 MB)" }, 413);

  const ext = EXT_BY_MIME[mime] ?? "png";
  const raw = (new URL(request.url).searchParams.get("name") || "").trim();
  const base = raw.replace(/\.[^.]+$/, "").replace(/[^\w -]/g, "").trim().slice(0, 60);
  const name = `${base || `image-${Date.now().toString(36)}`}.${ext}`;

  try {
    const token = await getDriveAccessToken(env);
    const folders = await getLibraryFolders(token, env);
    if (!folders?.images) return json({ error: "the library has no images/ folder" }, 501);
    const file = await driveCreateBinary(token, folders.images, name, mime, bytes);
    return json({ ok: true, id: file.id, name: file.name }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "upload failed" }, 502);
  }
}
