import type { Route } from "./+types/drive.library-save";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveCreateFile } from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { getLibraryFolders, type LibraryEnv } from "~/lib/library.server";

/**
 * Save a slide fragment into the library's `slides/` folder, so the gallery
 * grows from inside gmist. Gated by a signed-in session; the target folder is the
 * configured library, resolved server-side (the client cannot pick an arbitrary
 * destination).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  let body: { name?: string; markdown?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const md = (body.markdown ?? "").trim();
  let name = (body.name ?? "").trim();
  if (!name || !md) return Response.json({ error: "missing name or content" }, { status: 400 });
  if (!/\.(md|qmd)$/i.test(name)) name += ".md";

  try {
    const token = await getDriveAccessToken(env);
    const folders = await getLibraryFolders(token, env);
    if (!folders?.slides) return Response.json({ error: "the library has no slides/ folder" }, { status: 501 });
    const file = await driveCreateFile(token, folders.slides, name, md);
    return Response.json({ ok: true, id: file.id, name: file.name }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "save failed" }, { status: 502 });
  }
}
