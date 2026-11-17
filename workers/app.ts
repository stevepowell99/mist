import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest, getAgentByName } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { authorizeDoc, type DriveSessionEnv } from "../app/lib/drive-access.server";
import { internalHeaders, type ResolvedDoc } from "../app/lib/doc-resolve.server";

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
 * and require that its Drive sharing grants the viewer: a signed-in user it is
 * shared with, or anyone-with-link (`authorizeDoc`, the same check the doc
 * loader uses). Returns a rejection Response, or null to allow.
 */
async function gateAgentRequest(request: Request, env: Env, docId: string, key: string | null): Promise<Response | null> {
  try {
    const stub = await getAgentByName(env.DocumentAgent, docId);
    const metaRes = await stub.fetch(
      new Request(`https://do/?k=${encodeURIComponent(key ?? "")}`, { headers: internalHeaders(env) }),
    );
    const meta = (await metaRes.json()) as ResolvedDoc;
    if (!meta.exists) return new Response("not found", { status: 404 });
    const auth = await authorizeDoc(
      env as unknown as DriveSessionEnv,
      request,
      meta.drive ?? null,
      meta.role ?? null,
      meta.sharing,
    );
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
    // A POST creates the room, which cannot exist yet, so the gate would always
    // 404 it. Creation is one-shot in the agent (409 on an existing id, keys never
    // re-issued), and /new already creates rooms ungated, so this grants nothing.
    if (agentMatch && request.method !== "POST") {
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
