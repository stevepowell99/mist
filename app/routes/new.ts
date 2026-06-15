import { redirect } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/new";
import { generateDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads, serializeThreads } from "~/lib/thread-serialization";

const MAX_CONTENT_BYTES = 1_000_000; // 1 MB

function textError(message: string, status: number) {
  return new Response(`error: ${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

export function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_CONTENT_BYTES) {
      return textError("content too large (max 1MB)", 413);
    }

    const content = await request.text();

    if (content.length > MAX_CONTENT_BYTES) {
      return textError("content too large (max 1MB)", 413);
    }

    if (content.includes("\0")) {
      return textError("file appears to be binary, not text", 400);
    }

    const id = generateDocumentId();
    const { env } = getCloudflare(context);
    const stub = await getAgentByName(env.DocumentAgent, id);

    const init: RequestInit = { method: "POST" };

    if (content.trim()) {
      const { body, threads, frontmatter } = deserializeThreads(content);
      init.headers = { "Content-Type": "application/json" };
      // The editor body carries the file's own YAML frontmatter (the mist:
      // thread block removed); save folds the threads back into mist: on commit.
      init.body = JSON.stringify({ content: serializeThreads(body, [], frontmatter), threads });
    }

    const res = await stub.fetch(new Request("https://do/", init));

    if (!res.ok) {
      try {
        const err = (await res.json()) as { error?: string };
        return textError(err.error ?? "failed to create document", res.status);
      } catch {
        return textError("failed to create document", res.status);
      }
    }

    const { editKey } = (await res.json()) as { editKey: string };
    const url = new URL(request.url);
    return new Response(`${url.origin}/docs/${id}?k=${editKey}\n`, {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}
