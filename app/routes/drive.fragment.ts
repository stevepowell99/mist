import type { Route } from "./+types/drive.fragment";
import { getCloudflare } from "~/lib/cloudflare.server";
import { driveConfigured, getDriveAccessToken, driveDownload } from "~/lib/google.server";
import { driveAccess, driveUnauthenticated, driveForbidden } from "~/lib/drive-access.server";
import { isInLibrary, type LibraryEnv } from "~/lib/library.server";
import { stripMistBanner } from "~/shared/mist-banner";

/**
 * Return a library slide fragment's raw markdown by id, for the gallery to insert
 * at the cursor. Gated by a signed-in session AND by the file living inside the
 * library subtree, so this never becomes a read-any-markdown endpoint.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const access = await driveAccess(request, env);
  if (!access.ok) return driveUnauthenticated();
  if (!driveConfigured(env)) return Response.json({ error: "Drive not configured" }, { status: 501 });

  try {
    const token = await getDriveAccessToken(env);
    if (!(await isInLibrary(token, env, id))) return driveForbidden();
    const text = new TextDecoder().decode(await driveDownload(token, id));
    return Response.json({ markdown: stripMistBanner(text) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "fragment failed" }, { status: 502 });
  }
}
