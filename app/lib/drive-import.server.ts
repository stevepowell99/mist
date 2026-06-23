import { getAgentByName } from "agents";
import { generateDocumentId } from "~/shared/constants";
import { deserializeThreads, serializeThreads } from "~/lib/thread-serialization";
import { DriveBackend } from "~/lib/backend.server";
import { getDriveAccessToken, driveGetMeta, parseDriveFileId } from "~/lib/google.server";
import type { DriveMeta } from "~/shared/types";
import { stripMistBanner } from "~/shared/mist-banner";
import { fileAccessRole } from "~/lib/drive-access.server";

/**
 * Open a Google Drive markdown file into a new gmist room, seeded from the file's
 * current content and bound to it for write-back. Shared by the POST /drive/import
 * route (the in-app quick-open / sidebar) and the GET /open route (a direct
 * deep-link from an external tool, e.g. TagFox). The caller does the session gate
 * (openDriveRequest) and passes the signed-in user's email; the file's own Drive
 * sharing decides the role (writer -> edit link, commenter/reader -> suggest link).
 */
export type ImportToRoomResult =
  | { ok: true; url: string; role: "edit" | "suggest" }
  | { ok: false; error: string; status: number };

export async function importDriveFileToRoom(
  env: Env,
  fileIdOrUrl: string | null | undefined,
  accessEmail: string | null,
): Promise<ImportToRoomResult> {
  const fileId = fileIdOrUrl ? parseDriveFileId(fileIdOrUrl) : null;
  if (!fileId) return { ok: false, error: "not a Drive file URL or id", status: 400 };

  const docRole = await fileAccessRole(env, fileId, accessEmail);
  if (!docRole) return { ok: false, error: "forbidden", status: 403 };

  let drive: DriveMeta;
  let content: string;
  let driveVersion: string | null = null;
  try {
    const token = await getDriveAccessToken(env);
    const meta = await driveGetMeta(token, fileId);
    const lower = meta.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".qmd")) {
      return { ok: false, error: "only .md or .qmd files can be opened", status: 400 };
    }
    drive = { fileId: meta.id, name: meta.name, folderId: meta.parents?.[0] };
    const read = await new DriveBackend(drive, env).read();
    content = stripMistBanner(read.text);
    driveVersion = read.version;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Drive read failed", status: 502 };
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
      // the file's headRevisionId at open, the baseline for conditional writes so
      // a live save never clobbers a change made in Obsidian/Drive.
      body: JSON.stringify({ content: serializeThreads(body, [], frontmatter), threads, drive, driveVersion }),
    }),
  );
  if (!res.ok) return { ok: false, error: "failed to create document", status: 502 };

  const { editKey, suggestKey } = (await res.json()) as { editKey: string; suggestKey: string };
  // A Drive commenter/reader gets the suggest link, so they can only suggest.
  const key = docRole === "edit" ? editKey : suggestKey;
  return { ok: true, url: `/docs/${id}?k=${key}`, role: docRole === "edit" ? "edit" : "suggest" };
}
