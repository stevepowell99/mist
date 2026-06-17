import { getAgentByName } from "agents";
import type { Route } from "./+types/drive.import";
import { generateDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads, serializeThreads } from "~/lib/thread-serialization";
import { DriveBackend } from "~/lib/backend.server";
import {
  getDriveAccessToken,
  driveGetMeta,
  parseDriveFileId,
} from "~/lib/google.server";
import type { DriveMeta } from "~/shared/types";
import { stripMistBanner } from "~/shared/mist-banner";
import { openDriveRequest, fileAccessRole, driveForbidden } from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";

/**
 * Open a Google Drive markdown file into a new mist document, seeded from the
 * file's current content and bound to it for write-back. Auth is the relay's
 * own Drive identity; the resulting doc is behind a secret link for now (the
 * signed-in ACL path lands later, see plans/live-collab.md).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { env } = getCloudflare(context);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return gate.error;
  const { access } = gate;

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
  // The file's own Drive sharing decides the mist role: a writer/owner edits, a
  // commenter or reader gets a suggest-only link. No access at all is forbidden.
  const docRole = await fileAccessRole(env, fileId, access.email);
  if (!docRole) return driveForbidden();

  let drive: DriveMeta;
  let content: string;
  let driveVersion: string | null = null;
  try {
    const token = await getDriveAccessToken(env);
    const meta = await driveGetMeta(token, fileId);
    const lower = meta.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".qmd")) {
      return json({ error: "only .md or .qmd files can be opened" }, 400);
    }
    drive = { fileId: meta.id, name: meta.name, folderId: meta.parents?.[0] };
    const read = await new DriveBackend(drive, env).read();
    content = stripMistBanner(read.text);
    driveVersion = read.version;
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
      // The editor body carries the file's own YAML frontmatter (mist: block
      // removed); save folds threads back into mist: on commit. driveVersion is
      // the file's headRevisionId at open, the baseline for conditional writes
      // so live save never clobbers a change made in Obsidian/Drive.
      body: JSON.stringify({ content: serializeThreads(body, [], frontmatter), threads, drive, driveVersion }),
    }),
  );

  if (!res.ok) {
    return json({ error: "failed to create document" }, 502);
  }

  const { editKey, suggestKey } = (await res.json()) as { editKey: string; suggestKey: string };
  // A Drive commenter/reader opens the suggest link, so they can only suggest.
  const key = docRole === "edit" ? editKey : suggestKey;
  return json({ url: `/docs/${id}?k=${key}` }, 201);
}
