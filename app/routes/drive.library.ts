import type { Route } from "./+types/drive.library";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken } from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { getLibraryFolders, type LibraryEnv } from "~/lib/library.server";

/**
 * Resolve the reusable library's `slides/` and `images/` subfolder ids for the
 * gallery, from the LIBRARY_FOLDER_ID worker var. The gallery then lists each
 * with the existing /drive/search. Gated by a signed-in session.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context) as { env: LibraryEnv };
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  try {
    const token = await getDriveAccessToken(env);
    const folders = await getLibraryFolders(token, env);
    if (!folders) return Response.json({ configured: false });
    return Response.json({ configured: true, slides: folders.slides, images: folders.images });
  } catch (err) {
    return Response.json({ configured: false, error: err instanceof Error ? err.message : "library failed" }, { status: 502 });
  }
}
