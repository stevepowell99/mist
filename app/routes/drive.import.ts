import { getAgentByName } from "agents";
import type { Route } from "./+types/drive.import";
import { generateDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { DriveBackend } from "~/lib/backend.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveGetMeta,
  parseDriveFileId,
} from "~/lib/google.server";
import type { DriveMeta } from "~/shared/types";
import { stripMistBanner } from "~/shared/mist-banner";
import { driveKeyOk, driveUnauthorized } from "~/lib/drive-auth.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Open a Google Drive markdown file into a new mist document, seeded from the
 * file's current content and bound to it for write-back. Auth is the relay's
 * own Drive identity; the resulting doc is behind a secret link for now (the
 * signed-in ACL path lands later, see plans/live-collab.md).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { env } = getCloudflare(context);
  if (!driveKeyOk(request, env)) return driveUnauthorized();
  if (!driveConfigured(env)) {
    return json({ error: "Drive is not configured on this server" }, 501);
  }

  let payload: { url?: string };
  try {
    payload = (await request.json()) as { url?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  const fileId = payload.url ? parseDriveFileId(payload.url) : null;
  if (!fileId) {
    return json({ error: "not a Drive file URL or id" }, 400);
  }

  let drive: DriveMeta;
  let content: string;
  try {
    const token = await getDriveAccessToken(env);
    const meta = await driveGetMeta(token, fileId);
    const lower = meta.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".qmd")) {
      return json({ error: "only .md or .qmd files can be opened" }, 400);
    }
    drive = { fileId: meta.id, name: meta.name, folderId: meta.parents?.[0] };
    const { text } = await new DriveBackend(drive, env).read();
    content = stripMistBanner(text);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Drive read failed" }, 502);
  }

  const id = generateDocumentId();
  const stub = await getAgentByName(env.DocumentAgent, id);

  const { body, threads, frontmatter } = deserializeThreads(content);
  const res = await stub.fetch(
    new Request("https://do/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, frontmatter, drive }),
    }),
  );

  if (!res.ok) {
    return json({ error: "failed to create document" }, 502);
  }

  const { editKey } = (await res.json()) as { editKey: string };
  return json({ url: `/docs/${id}?k=${editKey}` }, 201);
}
