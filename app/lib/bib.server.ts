import {
  driveListFolder,
  driveGetMeta,
  driveDownload,
  driveResolvePath,
  isLocalMode,
} from "~/lib/google.server";
import { pathToId } from "~/lib/localfs-ids";
import { extractBibPaths } from "~/lib/slides-build";
import { rawFrontmatter } from "~/lib/thread-serialization";
import type { DriveMeta } from "~/shared/types";

const isBib = (n: string) => /\.bib$/i.test(n);

/** All `.bib` files in this folder and in an `assets/` subfolder of it. */
async function bibsInFolder(token: string, folderId: string): Promise<string[]> {
  const entries = await driveListFolder(token, folderId);
  const ids = entries.filter((e) => !e.isFolder && isBib(e.name)).map((e) => e.id);
  const assets = entries.find((e) => e.isFolder && e.name.toLowerCase() === "assets");
  if (assets) {
    const sub = await driveListFolder(token, assets.id);
    ids.push(...sub.filter((e) => !e.isFolder && isBib(e.name)).map((e) => e.id));
  }
  return ids;
}

/**
 * The BibTeX library for a document in `folderId`, as raw text ("" when there is
 * none). The document's own `bibliography:` paths are honoured first, resolved
 * relative to its folder like css: and images. Failing those, it walks UP from
 * the folder, checking each ancestor and its `assets/` subfolder, because a
 * library is rarely kept beside the document. Every `.bib` on the way up is
 * merged, not just the nearest level's: a small hand-kept bib near a document
 * supplements the main library further up rather than replacing it (the garden
 * keeps `content/assets/extra-refs.bib` and reads the Zotero export at the
 * Causal Map root, four levels above its notes). The nearest copy of a key wins:
 * parseBib keeps the last entry it reads for a key, so the text is joined
 * farthest level first.
 */
export async function findBibText(
  env: Env,
  token: string,
  folderId: string,
  paths: string[],
): Promise<string> {
  let bibIds: string[] = [];

  for (const p of paths.filter(Boolean)) {
    try {
      // An absolute local path is allowed, and is the only thing that works for
      // a repo whose library lives outside it: the folder walk only climbs the
      // document's own ancestors, so a bib in another tree (Steve's Zotero
      // library under My Drive, against a document in C:\dev) is never found.
      const abs = isLocalMode(env) && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("~/"));
      const id = abs ? pathToId(p.split("/").join("\\")) : await driveResolvePath(token, folderId, p);
      if (id) bibIds.push(id);
    } catch {
      // a bad bibliography path just falls through to the folder walk
    }
  }

  if (!bibIds.length) {
    const levels: string[][] = [];
    let current: string | undefined = folderId;
    for (let depth = 0; current && depth < 6; depth++) {
      levels.push(await bibsInFolder(token, current));
      current = (await driveGetMeta(token, current)).parents?.[0];
    }
    bibIds = levels.reverse().flat();
  }
  if (!bibIds.length) return "";

  const parts = await Promise.all(bibIds.map((id) => driveDownload(token, id)));
  return parts.map((b) => new TextDecoder().decode(b)).join("\n");
}

/**
 * The library for a page built on the server from a document's source (the deck
 * page, the document print page), as raw BibTeX. It is looked up here because a
 * public viewer, and the headless browser that prints a PDF, has no session to
 * fetch /drive/bib with. A failed lookup is logged and gives "", so the page
 * renders with its citation keys unresolved rather than failing.
 */
export async function bibForSource(
  env: Env,
  token: string,
  drive: DriveMeta,
  source: string,
  label: string,
): Promise<string> {
  try {
    const bib = drive.folderId
      ? await findBibText(env, token, drive.folderId, extractBibPaths(rawFrontmatter(source)))
      : "";
    if (!bib.trim()) console.log(`[bib] ${label}: no bibliography found (folder ${drive.folderId ?? "unknown"})`);
    return bib;
  } catch (err) {
    console.error(`[bib] ${label}: bibliography lookup failed: ${err instanceof Error ? err.message : err}`);
    return "";
  }
}
