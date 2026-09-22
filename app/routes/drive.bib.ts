import type { Route } from "./+types/drive.bib";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken } from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { findBibText } from "~/lib/bib.server";

/**
 * The BibTeX library for a Drive-backed doc (see `findBibText`). Gated by
 * sign-in but NOT by per-file folder sharing: the bib is incidental to a doc the
 * user already opened, and in Drive a file can be shared without its parent
 * folder, so a folder check would wrongly deny it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const params = new URL(request.url).searchParams;
  const folder = params.get("folder");
  if (!folder) return new Response("missing folder", { status: 400 });

  try {
    const token = await getDriveAccessToken(env);
    // No bib is a normal state, not an error: an empty library (200) means the
    // client just shows no references, rather than logging a 404.
    const text = await findBibText(env, token, folder, params.getAll("path"));
    return new Response(text, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bib lookup failed", { status: 502 });
  }
}
