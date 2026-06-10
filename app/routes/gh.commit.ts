import { getAgentByName } from "agents";
import type { Route } from "./+types/gh.commit";
import { isValidDocumentId } from "~/shared/constants";
import type { DocRole, GitHubMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { commitFile } from "~/lib/github.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Commit the reviewed markdown back to the source repo. Admin-gated: the
 * write PAT is the server's, so only a caller with the admin key may trigger
 * it, not every edit-link holder.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { env } = getCloudflare(context);
  if (!env.GITHUB_TOKEN) return json({ error: "commit-back is not configured on this server" }, 501);

  let payload: { docId?: string; key?: string; adminKey?: string; content?: string; message?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  if (!env.ADMIN_KEY || payload.adminKey !== env.ADMIN_KEY) {
    return json({ error: "invalid admin key" }, 403);
  }
  if (!payload.docId || !isValidDocumentId(payload.docId)) {
    return json({ error: "bad document id" }, 400);
  }
  if (typeof payload.content !== "string") {
    return json({ error: "missing content" }, 400);
  }

  const stub = await getAgentByName(env.DocumentAgent, payload.docId);
  const metaRes = await stub.fetch(
    new Request(`https://do/?k=${encodeURIComponent(payload.key ?? "")}`),
  );
  const meta = (await metaRes.json()) as { role: DocRole | null; github: GitHubMeta | null };

  if (meta.role !== "edit") return json({ error: "edit access required" }, 403);
  if (!meta.github) return json({ error: "document is not linked to a GitHub file" }, 400);

  try {
    const result = await commitFile(
      env.GITHUB_TOKEN,
      meta.github,
      payload.content,
      payload.message?.trim() || `Update ${meta.github.path} via mist`,
    );
    return json({ ok: true, sha: result.sha });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "commit failed" }, 502);
  }
}
