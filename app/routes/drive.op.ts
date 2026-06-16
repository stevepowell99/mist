import type { Route } from "./+types/drive.op";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveCreateFile,
  driveRename,
  driveCopy,
  driveTrash,
  driveGetMeta,
  driveListFolder,
} from "~/lib/google.server";
import { driveAccess, canAccessFile, driveUnauthenticated, driveForbidden } from "~/lib/drive-access.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Ensure a markdown-ish extension on a new/renamed file name. */
function withExt(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return /\.(md|qmd)$/i.test(n) ? n : `${n}.md`;
}

/** Next free "base (n).ext" in a folder, given the original name and the names
 *  already present. Strips an existing " (n)" so duplicating "foo (1).md" gives
 *  "foo (2).md", not "foo (1) (1).md". Drive's copy API otherwise keeps the
 *  original name, leaving two identically-named files in the folder. */
function nextDuplicateName(original: string, existing: string[]): string {
  const m = original.match(/^(.*?)(\.(?:md|qmd))?$/i);
  const stem = (m?.[1] ?? original).replace(/ \(\d+\)$/, "");
  const ext = m?.[2] ?? "";
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * File operations on Drive for the browser's New button and per-row action menu:
 * create, rename, duplicate, trash (recoverable, not permanent delete). Gated by
 * the shared Drive passphrase.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { env } = getCloudflare(context);
  const access = await driveAccess(request, env);
  if (!access.ok) return driveUnauthenticated();
  if (!driveConfigured(env)) return json({ error: "Drive not configured" }, 501);

  let body: { action?: string; folderId?: string; fileId?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  // Per-file sharing check on the operation's target (the folder for create, the
  // file otherwise). Absent ids fall through to the per-case validation below.
  const target = body.action === "create" ? body.folderId : body.fileId;
  if (target && !(await canAccessFile(env, target, access.email))) return driveForbidden();

  try {
    const token = await getDriveAccessToken(env);
    switch (body.action) {
      case "create": {
        if (!body.folderId || !body.name?.trim()) return json({ error: "folderId and name required" }, 400);
        const file = await driveCreateFile(token, body.folderId, withExt(body.name), "");
        return json({ file }, 201);
      }
      case "rename": {
        if (!body.fileId || !body.name?.trim()) return json({ error: "fileId and name required" }, 400);
        await driveRename(token, body.fileId, withExt(body.name));
        return json({ ok: true });
      }
      case "duplicate": {
        if (!body.fileId) return json({ error: "fileId required" }, 400);
        // Drive's copy keeps the original name, so derive a free "name (n).ext"
        // in the same folder when the caller did not supply an explicit name.
        let name = body.name ? withExt(body.name) : undefined;
        if (!name) {
          const meta = await driveGetMeta(token, body.fileId);
          const parent = meta.parents?.[0];
          const siblings = parent ? await driveListFolder(token, parent) : [];
          name = nextDuplicateName(meta.name, siblings.map((e) => e.name));
        }
        const file = await driveCopy(token, body.fileId, name);
        return json({ file }, 201);
      }
      case "trash": {
        if (!body.fileId) return json({ error: "fileId required" }, 400);
        await driveTrash(token, body.fileId);
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "operation failed" }, 502);
  }
}
