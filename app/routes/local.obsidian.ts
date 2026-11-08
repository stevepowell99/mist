import type { Route } from "./+types/local.obsidian";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { isLocalMode, localFilePath } from "~/lib/google.server";
import { DEPLOYED_ORIGIN } from "~/shared/constants";

/**
 * Where a file is on this machine, as the `obsidian://` link that opens it
 * (Ctrl/Cmd+O in either editor, via `openInObsidian`).
 *
 * Obsidian needs the file's path on this machine, which only the local gmist
 * can know: the deployed site has a Drive file id and nothing else. So both
 * editors ask here, and the sidecar turns the id into a path, a local id
 * directly and a Drive id through Drive for Desktop's own database (as for
 * `drive:<id>` images). The editor then opens the link from its own page,
 * because Chrome launches an app only from the page the key was pressed in: a
 * redirect in a new tab is silently dropped. Hence JSON, readable by the
 * deployed site through CORS, rather than a redirect. Markdown only, because
 * Obsidian hands other file types to their default app.
 */
function withCors(request: Request, res: Response): Response {
  if (request.headers.get("Origin") === DEPLOYED_ORIGIN) {
    res.headers.set("Access-Control-Allow-Origin", DEPLOYED_ORIGIN);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

function reply(request: Request, body: { url: string } | { error: string }, status = 200): Response {
  return withCors(request, Response.json(body, { status }));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return reply(request, { error: "Open in Obsidian needs the local gmist on this machine." }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return withCors(request, gate.error);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return reply(request, { error: "missing ?id=" }, 400);
  let abs: string;
  try {
    abs = await localFilePath(env, id);
  } catch (err) {
    return reply(request, { error: `this file is not on this machine (${err instanceof Error ? err.message : "lookup failed"})` }, 404);
  }
  if (!/\.(md|qmd|markdown)$/i.test(abs)) return reply(request, { error: `only markdown files open in Obsidian: ${abs}` }, 400);
  return reply(request, { url: `obsidian://open?path=${encodeURIComponent(abs)}` });
}

/** A preflight, for a Chrome that still asks before a public page reads localhost. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "OPTIONS") return reply(request, { error: "method not allowed" }, 405);
  const res = withCors(request, new Response(null, { status: 204 }));
  res.headers.set("Access-Control-Allow-Methods", "GET");
  res.headers.set("Access-Control-Allow-Private-Network", "true");
  return res;
}
