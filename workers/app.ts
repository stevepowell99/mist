import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest, getAgentByName } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { authorizeDoc, type DriveSessionEnv } from "../app/lib/drive-access.server";
import type { DocRole, DriveMeta } from "../app/shared/types";

export { default as DocumentAgent } from "../agents/document";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

/**
 * Gate the agent WebSocket, which is the real edit channel. The secret link key
 * alone must NOT grant access to a Drive-bound document: routeAgentRequest would
 * otherwise connect anyone holding the link, regardless of the file's Drive
 * sharing. So before letting the upgrade through, look up the doc's bound file
 * and require a signed-in user the file is shared with (the same check the doc
 * loader and drive.import use). Returns a rejection Response, or null to allow.
 */
async function gateAgentRequest(request: Request, env: Env, docId: string, key: string | null): Promise<Response | null> {
  try {
    const stub = await getAgentByName(env.DocumentAgent, docId);
    const metaRes = await stub.fetch(new Request(`https://do/?k=${encodeURIComponent(key ?? "")}`));
    const meta = (await metaRes.json()) as { exists?: boolean; role?: DocRole | null; drive?: DriveMeta | null };
    if (!meta.exists) return new Response("not found", { status: 404 });
    const auth = await authorizeDoc(env as unknown as DriveSessionEnv, request, meta.drive ?? null, meta.role ?? null);
    if (auth.status === "ok") return null;
    if (auth.status === "needsAuth") return new Response("sign in required", { status: 401 });
    return new Response("no access to this file", { status: 403 }); // forbidden / badkey
  } catch {
    return new Response("access check failed", { status: 503 }); // fail closed
  }
}

export default {
  async fetch(request, env, ctx) {
    // routeAgentRequest routes /agents/:agent/:name to the Durable Object. Gate
    // those requests first: the WebSocket is where edits flow, so the per-file
    // Drive ACL must be enforced here, not only on the page loader.
    const url = new URL(request.url);
    const agentMatch = url.pathname.match(/^\/agents\/[^/]+\/([^/?]+)/);
    if (agentMatch) {
      const denied = await gateAgentRequest(request, env, decodeURIComponent(agentMatch[1]), url.searchParams.get("k"));
      if (denied) return denied;
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Create context provider with cloudflare bindings for middleware mode
    const contextProvider = new RouterContextProvider();
    contextProvider.set(cloudflareContext, { env, ctx });

    return requestHandler(request, contextProvider);
  },
} satisfies ExportedHandler<Env>;
