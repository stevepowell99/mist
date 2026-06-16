import type { Route } from "./+types/docs.$id.folder";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { DriveBackend } from "~/lib/backend.server";
import { driveAccess, driveUnauthenticated } from "~/lib/drive-access.server";
import type { DocRole, DriveMeta } from "~/shared/types";

/**
 * Folder listing for a Drive-backed document, for the slide-out sidebar. Gated
 * by the document's secret key and the signed-in user's Drive access (it browses
 * the relay's Drive). Returns the entries in a folder (defaulting to the
 * document's own folder), the parent ref to walk up, and the folder's display
 * name.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const docKey = url.searchParams.get("k") ?? "";
  const ref = url.searchParams.get("ref");

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request(`https://do/?k=${encodeURIComponent(docKey)}`));
  const { role, drive } = (await res.json()) as {
    role: DocRole | null;
    drive: DriveMeta | null;
  };

  if (!role) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const empty = { entries: [], folderRef: null, parentRef: null, currentPath: null, folderName: null };

  try {
    if (drive) {
      if (!(await driveAccess(request, env)).ok) return driveUnauthenticated();
      const backend = new DriveBackend(drive, env);
      const folderRef = ref ?? backend.folderRef();
      const [entries, parentRef, folderName] = await Promise.all([
        backend.list(folderRef),
        backend.parentRef(folderRef),
        backend.folderName(folderRef),
      ]);
      return Response.json({ entries, folderRef, parentRef, currentPath: drive.fileId, folderName });
    }

    // Not folder-backed; the sidebar simply does not show.
    return Response.json(empty);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "could not list folder" },
      { status: 502 },
    );
  }
}
