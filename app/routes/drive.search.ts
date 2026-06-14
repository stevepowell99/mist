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
import { driveKeyOk, driveUnauthorized } from "~/lib/drive-auth.server";

export interface SearchResult {
  id: string;
  name: string;
  kind: DriveKind;
  /** Parent folder path, shown as a breadcrumb above the name. */
  path: string;
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
  const { env } = getCloudflare(context);
  if (!driveKeyOk(request, env)) return driveUnauthorized();
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

  try {
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
