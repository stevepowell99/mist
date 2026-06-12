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
import type { GitHubMeta } from "~/shared/types";
import { fetchPublicText, fetchPublicDir, commitFile } from "./github.server";
import { dirOf } from "./github";

/** One entry in a folder listing. */
export interface BackendEntry {
  name: string;
  isFolder: boolean;
  /** Opaque handle: a folder ref to pass back to list(), or a doc ref to open(). */
  ref: string;
}

export interface DocBackend {
  /** Current text plus a version token (GitHub sha / Drive etag), null if none. */
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

  // Folder navigation (backends that have folders: GitHub directories, Drive).
  /** The folder ref containing this document, the sidebar's starting point. */
  folderRef?(): string;
  /** Entries in a folder, defaulting to this document's folder. Folders first. */
  list?(folderRef?: string): Promise<BackendEntry[]>;
  /** The parent folder ref, or null at the shared root. */
  parentRef?(folderRef: string): string | null;

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
      .filter((e) => e.type === "dir" || e.name.toLowerCase().endsWith(".md"))
      .map((e) => ({ name: e.name, isFolder: e.type === "dir", ref: e.path }))
      .sort(byFolderThenName);
  }

  parentRef(folderRef: string): string | null {
    // "" is the repo root; there is nothing above it.
    return folderRef === "" ? null : dirOf(folderRef);
  }
}
