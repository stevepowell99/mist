import type { Route } from "./+types/docs.$id.folder";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { GitHubBackend } from "~/lib/backend.server";
import type { DocRole, GitHubMeta } from "~/shared/types";

/**
 * Folder listing for a GitHub-backed document, for the slide-out sidebar.
 * Gated by the same secret key as viewing the document. Returns the entries in
 * a folder (defaulting to the document's own folder), plus the parent ref so the
 * sidebar can walk up. Drive will serve the same shape later.
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
  const { role, github } = (await res.json()) as {
    role: DocRole | null;
    github: GitHubMeta | null;
  };

  if (!role) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!github) {
    // Not folder-backed; the sidebar simply does not show.
    return Response.json({ entries: [], folderRef: null, parentRef: null, currentPath: null, github: null });
  }

  const backend = new GitHubBackend(github);
  const folderRef = ref ?? backend.folderRef();
  try {
    const entries = await backend.list(folderRef);
    return Response.json({
      entries,
      folderRef,
      parentRef: backend.parentRef(folderRef),
      currentPath: github.path,
      github,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "could not list folder" },
      { status: 502 },
    );
  }
}
