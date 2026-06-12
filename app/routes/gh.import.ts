import { getAgentByName } from "agents";
import type { Route } from "./+types/gh.import";
import { generateDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { parseGitHubFileUrl } from "~/lib/github.server";
import { GitHubBackend } from "~/lib/backend.server";
import { stripMistBanner } from "~/shared/mist-banner";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Import a markdown file from a PUBLIC GitHub repo into a new document.
 * No auth: only public content is read, and the result is a fresh mist doc
 * behind a secret link.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: { url?: string };
  try {
    payload = (await request.json()) as { url?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  const file = payload.url ? parseGitHubFileUrl(payload.url) : null;
  if (!file) {
    return json({ error: "not a GitHub file URL (expected .../blob/<branch>/<path>)" }, 400);
  }
  const lower = file.path.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".qmd")) {
    return json({ error: "only .md or .qmd files can be imported" }, 400);
  }

  let content: string;
  try {
    const { text } = await new GitHubBackend(file).read();
    content = stripMistBanner(text);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "fetch failed" }, 502);
  }

  const id = generateDocumentId();
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);

  const { body, threads } = deserializeThreads(content);
  const res = await stub.fetch(
    new Request("https://do/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, github: file }),
    }),
  );

  if (!res.ok) {
    return json({ error: "failed to create document" }, 502);
  }

  const { editKey } = (await res.json()) as { editKey: string };
  return json({ url: `/docs/${id}?k=${editKey}` }, 201);
}
