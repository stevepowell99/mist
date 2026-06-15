import type { Route } from "./+types/drive.bib";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveListFolder,
  driveGetMeta,
  driveDownload,
} from "~/lib/google.server";
import { driveAccess, driveUnauthenticated } from "~/lib/drive-access.server";

const isBib = (n: string) => /\.bib$/i.test(n);

/** A `.bib` in this folder, or in an `assets/` subfolder of it. */
async function bibInFolder(token: string, folderId: string): Promise<string | null> {
  const entries = await driveListFolder(token, folderId);
  const direct = entries.find((e) => !e.isFolder && isBib(e.name));
  if (direct) return direct.id;
  const assets = entries.find((e) => e.isFolder && e.name.toLowerCase() === "assets");
  if (assets) {
    const sub = await driveListFolder(token, assets.id);
    const found = sub.find((e) => !e.isFolder && isBib(e.name));
    if (found) return found.id;
  }
  return null;
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
  if (!(await driveAccess(request, env)).ok) return driveUnauthenticated();
  if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });

  const folder = new URL(request.url).searchParams.get("folder");
  if (!folder) return new Response("missing folder", { status: 400 });

  try {
    const token = await getDriveAccessToken(env);
    let current: string | undefined = folder;
    let bibId: string | null = null;
    for (let depth = 0; current && depth < 6; depth++) {
      bibId = await bibInFolder(token, current);
      if (bibId) break;
      current = (await driveGetMeta(token, current)).parents?.[0];
    }
    if (!bibId) return new Response("no .bib found", { status: 404 });

    const body = await driveDownload(token, bibId);
    return new Response(body, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bib lookup failed", { status: 502 });
  }
}
