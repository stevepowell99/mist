import type { Route } from "./+types/drive.search";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  getDriveAccessToken,
  driveFiles,
  driveFilesUnderFolders,
  driveTrail,
  type DriveKind,
  type DriveSearchEntry,
} from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";

export interface SearchResult {
  id: string;
  name: string;
  kind: DriveKind;
  /** Parent folder path, shown as a clickable breadcrumb above the name. */
  path: string;
  /** Parent folder id, so the path navigates into that folder. */
  parentId: string | null;
  /** Ancestor folders top -> immediate parent, each a clickable breadcrumb. */
  trail: { id: string; name: string }[];
  /** A markdown file mist can open in the editor. */
  openInMist: boolean;
  /** Drive web link for opening anything else in a new tab. */
  webViewLink: string | null;
  /** A file surfaced because its PARENT folder matched the query, not its own
   *  name. Ranked below direct name hits in the quick-open palette. */
  viaParent?: boolean;
}

const FILTERABLE: DriveKind[] = ["folder", "markdown", "doc", "sheet", "slides", "pdf", "image"];

function toResult(e: DriveSearchEntry, viaParent = false): SearchResult {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    path: e.path,
    parentId: e.parentId,
    trail: e.trail,
    openInMist: e.kind === "markdown",
    webViewLink: e.webViewLink,
    ...(viaParent ? { viaParent: true } : {}),
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
    const gate = await openDriveRequest(request, env);
    if ("error" in gate) return gate.error;

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const folder = url.searchParams.get("folder") ?? undefined;
    const requested = (url.searchParams.get("types") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is DriveKind => (FILTERABLE as string[]).includes(t));
    const types = requested.length ? requested : (["markdown", "folder"] as DriveKind[]);

    const token = await getDriveAccessToken(env);
    const fullText = url.searchParams.get("full") === "1";
    // Listing a folder with no query (the library gallery browse) returns the
    // whole folder; a name search stays a short relevant list.
    const limit = folder && !q ? 1000 : 30;
    const entries = await driveFiles(token, { nameQuery: q || undefined, folderId: folder, types, fullText, limit });

    // Parent-folder expansion (the quick-open palette sets parents=1): for a
    // top-level name search, also surface markdown that lives in folders whose
    // NAME matched the query, flagged so the client ranks it below direct hits.
    // Reuses the folders the main search already returned, so no extra folder
    // query; capped so it stays one bounded Drive call.
    let parentResults: SearchResult[] = [];
    if (url.searchParams.get("parents") === "1" && q && !folder) {
      const folderIds = entries.filter((e) => e.kind === "folder").map((e) => e.id).slice(0, 6);
      const seen = new Set(entries.map((e) => e.id));
      const kids = await driveFilesUnderFolders(token, folderIds, ["markdown"], 40);
      parentResults = kids.filter((k) => !seen.has(k.id)).map((e) => toResult(e, true));
    }

    // When browsing a folder, also return its trail (top -> current) so the
    // panel can show a clickable breadcrumb and walk up.
    let folderInfo: { trail: { id: string; name: string }[] } | null = null;
    if (folder) {
      folderInfo = { trail: await driveTrail(token, folder) };
    }
    return Response.json({ results: [...entries.map((e) => toResult(e)), ...parentResults], folder: folderInfo });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
