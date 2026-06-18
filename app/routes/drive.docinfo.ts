import type { Route } from "./+types/drive.docinfo";
import { getAgentByName } from "agents";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getDriveAccessToken, driveFileDetails } from "~/lib/google.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";

/**
 * Details for the open document: richer Drive metadata (modified time, owner,
 * last editor, size, link) plus the document agent's diagnostic sync log
 * (open / adopt / conflict / save). Backs the file-details block in the Drive
 * sidebar. Gated by sign-in (openDriveRequest) and by the doc key (the agent
 * checks roleForKey for the sync log).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    const { env } = getCloudflare(context);
    const gate = await openDriveRequest(request, env);
    if ("error" in gate) return gate.error;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const k = url.searchParams.get("k") ?? "";
    if (!id) return json({ error: "missing id" }, 400);

    // Drive meta + the sync log come from the document agent (it holds both).
    const stub = await getAgentByName(env.DocumentAgent, id);
    const res = await stub.fetch(new Request(`https://do/?synclog=1&k=${encodeURIComponent(k)}`));
    if (!res.ok) return json({ file: null, log: [] });
    const info = (await res.json()) as { drive?: { fileId?: string } | null; log?: unknown[] };

    let file = null;
    if (info.drive?.fileId) {
      try {
        const token = await getDriveAccessToken(env);
        file = await driveFileDetails(token, info.drive.fileId);
      } catch {
        // file details are best-effort; still return the log
      }
    }
    return json({ file, log: info.log ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "failed" }, 502);
  }
}
