import type { Route } from "./+types/drive.op";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  driveConfigured,
  getDriveAccessToken,
  driveCreateFile,
  driveRename,
  driveCopy,
  driveTrash,
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
        const file = await driveCopy(token, body.fileId, body.name ? withExt(body.name) : undefined);
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
