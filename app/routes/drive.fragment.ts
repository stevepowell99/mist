import type { Route } from "./+types/drive.fragment";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveDownload } from "~/lib/google.server";
import { openDriveRequest, canAccessFile, driveForbidden } from "~/lib/drive-access.server";
import { isInLibrary, type LibraryEnv } from "~/lib/library.server";
import { stripMistBanner } from "~/shared/mist-banner";

/**
 * Return a slide source's raw markdown by id, for the gallery to insert at the
 * cursor. Two allowed sources: a fragment in the library subtree (curated), or
 * any deck the signed-in user can open in Drive (the "from a deck" tab). Gated so
 * it never becomes a read-any-markdown endpoint.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

  try {
    const token = await getDriveAccessToken(env);
    const allowed = (await isInLibrary(token, env, id)) || (await canAccessFile(env, id, access.email));
    if (!allowed) return driveForbidden();
    const text = new TextDecoder().decode(await driveDownload(token, id));
    return Response.json({ markdown: stripMistBanner(text) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "fragment failed" }, { status: 502 });
  }
}
