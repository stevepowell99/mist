import type { Route } from "./+types/drive.search";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveSearch,
  driveRecent,
  driveFolderChildren,
  type DriveSearchEntry,
} from "~/lib/google.server";
import { driveKeyOk, driveUnauthorized } from "~/lib/drive-auth.server";

export interface SearchResult {
  id: string;
  name: string;
  isFolder: boolean;
  /** A markdown file mist can open in the editor. */
  openInMist: boolean;
  /** Drive web link for opening anything else in a new tab. */
  webViewLink: string | null;
}

function toResult(e: DriveSearchEntry): SearchResult {
  return {
    id: e.id,
    name: e.name,
    isFolder: e.isFolder,
    openInMist: !e.isFolder && /\.(md|qmd)$/i.test(e.name),
    webViewLink: e.webViewLink,
  };
}

/**
 * Search Drive for the quick-open box. With `q` it name-matches; with `folder`
 * it lists that folder's children (drill-in); with neither it returns recent
 * files. Gated by the shared Drive passphrase.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!driveKeyOk(request, env)) return driveUnauthorized();
  if (!driveConfigured(env)) {
    return Response.json({ error: "Drive not configured" }, { status: 501 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const folder = url.searchParams.get("folder");

  try {
    const token = await getDriveAccessToken(env);
    const entries = folder
      ? await driveFolderChildren(token, folder)
      : q
        ? await driveSearch(token, q)
        : await driveRecent(token);
    return Response.json({ results: entries.map(toResult) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 },
    );
  }
}
