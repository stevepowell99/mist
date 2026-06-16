/**
 * Server-only document storage abstraction.
 *
 * A backend instance is bound to one document's storage location (today a
 * GitHub file; later a Google Drive file). The relay, the import route and the
 * folder sidebar talk to storage only through this interface, so adding Drive
 * is a new implementation rather than a second code path. See plans/live-collab.md.
 *
 * Folder refs are opaque strings the backend understands: a repo-relative path
 * for GitHub, a folder id for Drive. The sidebar passes them back to list() and
 * parentRef() without interpreting them.
 */
import type { DriveMeta, GitHubMeta } from "~/shared/types";
import { fetchPublicText, fetchPublicDir, commitFile } from "./github.server";
import { dirOf } from "./github";
import {
  type DriveEnv,
  getDriveAccessToken,
  driveRead,
  driveWrite,
  driveGetMeta,
  driveCreateFile,
  driveListFolder,
  driveListPermissions,
  emailHasAccess,
} from "./google.server";

/** One entry in a folder listing. */
export interface BackendEntry {
  name: string;
  isFolder: boolean;
  /** Opaque handle: a folder ref to pass back to list(), or a doc ref to open(). */
  ref: string;
}

export interface DocBackend {
  /** Current text plus a version token (GitHub sha / Drive headRevisionId), null if none. */
  read(): Promise<{ text: string; version: string | null }>;
  /**
   * Write new text. `expectedVersion` is the version the session loaded with,
   * for a conditional write; backends that cannot yet guard ignore it and
   * overwrite (see GitHubBackend). Returns the new version token.
   */
  write(
    text: string,
    expectedVersion: string | null,
    message: string,
  ): Promise<{ version: string | null }>;

  /** Write `text` to a sibling file (a named copy in the same location), so a
   *  divergence or a pre-reload snapshot loses nothing; returns the new name.
   *  Drive only. */
  saveSibling?(text: string, tag: string): Promise<string | null>;

  // Folder navigation (backends that have folders: GitHub directories, Drive).
  /** The folder ref containing this document, the sidebar's starting point. */
  folderRef?(): string;
  /** Entries in a folder, defaulting to this document's folder. Folders first. */
  list?(folderRef?: string): Promise<BackendEntry[]>;
  /** The parent folder ref, or null at the shared root. Async for backends
   *  (Drive) that must look the parent up. */
  parentRef?(folderRef: string): string | null | Promise<string | null>;

  /** Whether the signed-in user may access this document (Drive only). */
  canAccess?(userEmail: string): Promise<boolean>;
}

/** Folders first, then files, each alphabetical (case-insensitive). */
function byFolderThenName(a: BackendEntry, b: BackendEntry): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/**
 * GitHub-backed document: public read over raw.githubusercontent.com, public
 * directory listing over the contents API, write via the contents API with a
 * fine-grained PAT. Permission checks do not apply (GitHub docs use secret-link
 * auth), so canAccess is omitted.
 */
export class GitHubBackend implements DocBackend {
  constructor(
    private readonly meta: GitHubMeta,
    private readonly token?: string,
  ) {}

  async read(): Promise<{ text: string; version: string | null }> {
    // Public read needs no auth and no sha; the commit path supplies its own
    // sha inside commitFile. Version stays null until the bridge work needs it.
    const text = await fetchPublicText(this.meta);
    return { text, version: null };
  }

  async write(
    text: string,
    _expectedVersion: string | null,
    message: string,
  ): Promise<{ version: string | null }> {
    if (!this.token) throw new Error("commit-back not configured (no GITHUB_TOKEN)");
    // commitFile fetches the current sha and overwrites. The version-conditional
    // guard lands with the cloud bridge (plans/live-collab.md, step 2).
    const { sha } = await commitFile(this.token, this.meta, text, message);
    return { version: sha };
  }

  folderRef(): string {
    return dirOf(this.meta.path);
  }

  async list(folderRef?: string): Promise<BackendEntry[]> {
    const dir = folderRef ?? this.folderRef();
    const entries = await fetchPublicDir(this.meta, dir);
    return entries
      .filter((e) => e.type === "dir" || /\.(md|qmd)$/i.test(e.name))
      .map((e) => ({ name: e.name, isFolder: e.type === "dir", ref: e.path }))
      .sort(byFolderThenName);
  }

  parentRef(folderRef: string): string | null {
    // "" is the repo root; there is nothing above it.
    return folderRef === "" ? null : dirOf(folderRef);
  }
}

/**
 * Drive-backed document. The relay reads and writes through one fixed identity
 * (the stored refresh token), so every method mints an access token from env.
 * Folder refs are Drive folder ids. The document's parent folder id is stored in
 * the meta at open, so folderRef() needs no call.
 */
export class DriveBackend implements DocBackend {
  constructor(
    private readonly meta: DriveMeta,
    private readonly env: DriveEnv,
  ) {}

  private token(): Promise<string> {
    return getDriveAccessToken(this.env);
  }

  async read(): Promise<{ text: string; version: string | null }> {
    return driveRead(await this.token(), this.meta.fileId);
  }

  async write(
    text: string,
    expectedVersion: string | null,
    _message: string,
  ): Promise<{ version: string | null }> {
    const token = await this.token();
    // Conditional guard: if the file moved underneath us, reject so the caller
    // re-reads and reconciles rather than clobbering (the relay forks the other
    // version to a sibling, see DocumentAgent.checkUpstream).
    if (expectedVersion) {
      const current = await driveGetMeta(token, this.meta.fileId);
      if (current.version && current.version !== expectedVersion) {
        throw new Error("file changed upstream; reload and retry");
      }
    }
    return driveWrite(token, this.meta.fileId, text);
  }

  /** Write `text` to a sibling `<base> (<tag> <stamp>).<ext>` in the same folder,
   *  so a divergent or about-to-be-replaced version is preserved, never lost. */
  async saveSibling(text: string, tag: string): Promise<string | null> {
    const folder = this.meta.folderId;
    if (!folder) return null;
    const orig = this.meta.name ?? this.meta.fileId;
    const dot = orig.lastIndexOf(".");
    const base = dot > 0 ? orig.slice(0, dot) : orig;
    const ext = dot > 0 ? orig.slice(dot) : ".md";
    // RFC3339 to minute, filename-safe (no colons): e.g. 2026-06-16 1432.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
    const name = `${base} (${tag} ${stamp})${ext}`;
    const created = await driveCreateFile(await this.token(), folder, name, text);
    return created.name;
  }

  folderRef(): string {
    return this.meta.folderId ?? "";
  }

  async list(folderRef?: string): Promise<BackendEntry[]> {
    const folder = folderRef ?? this.folderRef();
    if (!folder) return [];
    const entries = await driveListFolder(await this.token(), folder);
    return entries
      .filter((e) => e.isFolder || /\.(md|qmd)$/i.test(e.name))
      .map((e) => ({ name: e.name, isFolder: e.isFolder, ref: e.id }))
      .sort(byFolderThenName);
  }

  async parentRef(folderRef: string): Promise<string | null> {
    if (!folderRef) return null;
    const meta = await driveGetMeta(await this.token(), folderRef);
    return meta.parents?.[0] ?? null;
  }

  /** Display name of a folder id, for the sidebar header. */
  async folderName(folderRef: string): Promise<string> {
    if (!folderRef) return "";
    try {
      return (await driveGetMeta(await this.token(), folderRef)).name;
    } catch {
      return "";
    }
  }

  async canAccess(userEmail: string): Promise<boolean> {
    const grants = await driveListPermissions(await this.token(), this.meta.fileId);
    return emailHasAccess(grants, userEmail);
  }
}
