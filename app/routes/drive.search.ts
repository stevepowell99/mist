import type { Route } from "./+types/drive.search";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveFiles,
  driveTrail,
  type DriveKind,
  type DriveSearchEntry,
} from "~/lib/google.server";
import { driveAccess, driveUnauthenticated } from "~/lib/drive-access.server";

export interface SearchResult {
  id: string;
  name: string;
  kind: DriveKind;
  /** Parent folder path, shown as a clickable breadcrumb above the name. */
  path: string;
  /** Parent folder id, so the path navigates into that folder. */
  parentId: string | null;
  /** A markdown file mist can open in the editor. */
  openInMist: boolean;
  /** Drive web link for opening anything else in a new tab. */
  webViewLink: string | null;
}

const FILTERABLE: DriveKind[] = ["folder", "markdown", "doc", "sheet", "slides", "pdf"];

function toResult(e: DriveSearchEntry): SearchResult {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    path: e.path,
    parentId: e.parentId,
    openInMist: e.kind === "markdown",
    webViewLink: e.webViewLink,
  };
}

/**
 * Search Drive for the quick-open box. With `q` it name-matches; with `folder`
 * it lists that folder's children (drill-in); with neither it returns recent
 * files. `types` restricts to chosen kinds (defaults to markdown + folders so
 * data junk does not crowd out documents). Gated by the shared Drive passphrase.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  // Whole body in one try so the loader ALWAYS returns JSON: an uncaught throw
  // would otherwise surface as React Router's plain-text "Unexpected Server
  // Error", which the client cannot parse.
  try {
    const { env } = getCloudflare(context);
    // Search runs as the relay over its own tree, so it cannot be scoped per file
    // without a permission call per result. v1 gates it behind a valid session;
    // opening a specific file IS enforced per-file in drive.import.
    const access = await driveAccess(request, env);
    if (!access.ok) return driveUnauthenticated();
    if (!driveConfigured(env)) {
      return Response.json({ error: "Drive not configured" }, { status: 501 });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const folder = url.searchParams.get("folder") ?? undefined;
    const requested = (url.searchParams.get("types") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is DriveKind => (FILTERABLE as string[]).includes(t));
    const types = requested.length ? requested : (["markdown", "folder"] as DriveKind[]);

    const token = await getDriveAccessToken(env);
    const entries = await driveFiles(token, { nameQuery: q || undefined, folderId: folder, types });
    // When browsing a folder, also return its trail (top -> current) so the
    // panel can show a clickable breadcrumb and walk up.
    let folderInfo: { trail: { id: string; name: string }[] } | null = null;
    if (folder) {
      folderInfo = { trail: await driveTrail(token, folder) };
    }
    return Response.json({ results: entries.map(toResult), folder: folderInfo });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
