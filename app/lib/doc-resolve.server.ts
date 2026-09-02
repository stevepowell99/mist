import { getAgentByName } from "agents";
import { isLocalFileId } from "~/lib/localfs-ids";
import { driveGetMeta, getDriveAccessToken, isLocalMode } from "~/lib/google.server";
import type { DocRole, DriveMeta } from "~/shared/types";

export interface ResolvedDoc {
  exists: boolean;
  createdAt: number | null;
  role: DocRole | null;
  suggestKey?: string;
  drive: DriveMeta | null;
}

/**
 * What a document id refers to. Every route that opens a document goes through
 * here rather than reaching for the agent itself, because the answer has two
 * shapes.
 *
 * A local document id IS its file's path, so the file is looked up directly:
 * there is no room, no secret key to check, and nothing that could hold a
 * different copy of the content. A Drive document still lives in a room, whose
 * agent owns its keys, its role and the file it is bound to.
 */
export async function resolveDoc(
  env: Env,
  id: string,
  docKey: string | null,
): Promise<ResolvedDoc> {
  if (isLocalFileId(id)) {
    if (!isLocalMode(env)) return { exists: false, createdAt: null, role: null, drive: null };
    try {
      const meta = await driveGetMeta(await getDriveAccessToken(env), id);
      return {
        exists: true,
        createdAt: null,
        // Local files are this machine's user's own, and the sidecar's token is
        // the access control, so there is no per-document role to hand out.
        role: "edit",
        drive: { fileId: meta.id, name: meta.name, folderId: meta.parents?.[0] },
      };
    } catch {
      return { exists: false, createdAt: null, role: null, drive: null };
    }
  }

  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(
    new Request(`https://do/?k=${encodeURIComponent(docKey ?? "")}`),
  );
  return (await res.json()) as ResolvedDoc;
}
