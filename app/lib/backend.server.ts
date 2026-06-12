/**
 * Server-only document storage abstraction.
 *
 * A backend instance is bound to one document's storage location (today a
 * GitHub file; later a Google Drive file). The relay and the import route talk
 * to storage only through this interface, so adding Drive is a new
 * implementation rather than a second code path. See plans/live-collab.md.
 *
 * Drive-only capabilities (folder navigation, permission checks) are optional
 * and absent on GitHubBackend, which uses secret-link auth and has no folders.
 */
import type { GitHubMeta } from "~/shared/types";
import { fetchPublicText, commitFile } from "./github.server";

/** One entry in a folder listing (Drive backends only). */
export interface BackendEntry {
  name: string;
  isFolder: boolean;
  /** Opaque handle the backend understands, e.g. a Drive file id. */
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
  /** List the entries beside this document (Drive only). */
  list?(): Promise<BackendEntry[]>;
  /** The parent folder as its own backend, or null at the shared root (Drive only). */
  parent?(): Promise<DocBackend | null>;
  /** Whether the signed-in user may access this document (Drive only). */
  canAccess?(userEmail: string): Promise<boolean>;
}

/**
 * GitHub-backed document: public read over raw.githubusercontent.com, write via
 * the contents API with a fine-grained PAT. Folder navigation and permission
 * checks do not apply (GitHub docs use secret-link auth), so they are omitted.
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
}
