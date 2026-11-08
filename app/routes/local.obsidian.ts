import type { Route } from "./+types/local.obsidian";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { isLocalMode, localFilePath } from "~/lib/google.server";

/**
 * Open a file in Obsidian (Ctrl/Cmd+O in either editor, via `openInObsidian`).
 *
 * Obsidian needs the file's path on this machine, which only the local gmist can
 * know: the deployed site has a Drive file id and nothing else. So both editors
 * send the id here, and the sidecar turns it into a path, a local id directly
 * and a Drive id through Drive for Desktop's own database (as for `drive:<id>`
 * images). Obsidian then opens the path in whichever of its vaults contains it.
 * Markdown only, because Obsidian hands other file types to their default app.
 */
function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return text("Open in Obsidian needs the local gmist on this machine.", 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return text("missing ?id=", 400);
  let abs: string;
  try {
    abs = await localFilePath(env, id);
  } catch (err) {
    return text(`Could not find this file on this machine: ${err instanceof Error ? err.message : "lookup failed"}`, 404);
  }
  if (!/\.(md|qmd|markdown)$/i.test(abs)) return text(`Only markdown files open in Obsidian: ${abs}`, 400);
  return new Response(null, { status: 302, headers: { Location: `obsidian://open?path=${encodeURIComponent(abs)}` } });
}
