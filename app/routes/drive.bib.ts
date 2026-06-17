import type { Route } from "./+types/drive.bib";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  getDriveAccessToken,
  driveListFolder,
  driveGetMeta,
  driveDownload,
  driveResolvePath,
} from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";

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
 * Find and return the BibTeX library for a Drive-backed doc. Bib libraries are
 * not kept beside the doc (e.g. an Obsidian vault keeps one at
 * `content/assets/MyLibrary.bib`), so this walks UP from the doc's folder,
 * checking each ancestor and its `assets/` subfolder, until it finds a `.bib`.
 * Gated by sign-in (or the passphrase) but NOT by per-file folder sharing: the
 * bib is incidental to a doc the user already opened, and in Drive a file can be
 * shared without its parent folder, so a folder check would wrongly deny it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const folder = new URL(request.url).searchParams.get("folder");
  if (!folder) return new Response("missing folder", { status: 400 });

  // Explicit `bibliography:` paths from the doc frontmatter, resolved relative to
  // the doc's folder (like css:/images). Honoured first, so a deck can point at
  // its library directly instead of relying on the folder walk.
  const explicit = new URL(request.url).searchParams.getAll("path").filter(Boolean);

  try {
    const token = await getDriveAccessToken(env);
    let bibIds: string[] = [];

    for (const p of explicit) {
      try {
        const id = await driveResolvePath(token, folder, p);
        if (id) bibIds.push(id);
      } catch {
        // a bad bibliography path just falls through to the folder walk
      }
    }

    if (!bibIds.length) {
      let current: string | undefined = folder;
      for (let depth = 0; current && depth < 6; depth++) {
        bibIds = await bibsInFolder(token, current);
        if (bibIds.length) break;
        current = (await driveGetMeta(token, current)).parents?.[0];
      }
    }
    // No bib is a normal state, not an error: return an empty library (200) so
    // the client just shows no references, rather than logging a 404.
    if (!bibIds.length) {
      return new Response("", {
        headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=60" },
      });
    }

    // Merge every .bib at that level (a vault can keep several); parseBib reads
    // concatenated BibTeX fine.
    const parts = await Promise.all(bibIds.map((id) => driveDownload(token, id)));
    const merged = parts.map((b) => new TextDecoder().decode(b)).join("\n");
    return new Response(merged, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bib lookup failed", { status: 502 });
  }
}
