import type { Route } from "./+types/drive.bib";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveListFolder,
  driveDownload,
} from "~/lib/google.server";
import { driveAccess, driveUnauthenticated } from "~/lib/drive-access.server";

/**
 * Find and return the BibTeX library for a Drive-backed doc: looks in the doc's
 * folder, then an `assets` subfolder, for a `.bib` file. One request, so no
 * noisy candidate-path 404s. Gated by sign-in (or the passphrase) but NOT by
 * per-file folder sharing: the bib is incidental to a doc the user already
 * opened, and in Drive a file can be shared without its parent folder, so a
 * folder check would wrongly deny the library.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!(await driveAccess(request, env)).ok) return driveUnauthenticated();
  if (!driveConfigured(env)) return new Response("Drive not configured", { status: 501 });

  const folder = new URL(request.url).searchParams.get("folder");
  if (!folder) return new Response("missing folder", { status: 400 });

  try {
    const token = await getDriveAccessToken(env);
    const entries = await driveListFolder(token, folder);
    const isBib = (n: string) => /\.bib$/i.test(n);

    let bibId = entries.find((e) => !e.isFolder && isBib(e.name))?.id;
    if (!bibId) {
      const assets = entries.find((e) => e.isFolder && e.name.toLowerCase() === "assets");
      if (assets) {
        const sub = await driveListFolder(token, assets.id);
        bibId = sub.find((e) => !e.isFolder && isBib(e.name))?.id;
      }
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
