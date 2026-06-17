/**
 * The reusable slide/image library (plans/slide-image-library.md). It is ONE
 * canonical Drive folder, set by the LIBRARY_FOLDER_ID worker var, holding two
 * subfolders resolved by name: `slides/` (.md fragments) and `images/`. gmist is
 * a thin UI over the existing Drive enumeration; this module just resolves the
 * folders and enforces the security gate that id-mode reads stay inside it.
 */
import { driveListFolder, driveGetMeta, type DriveEnv } from "~/lib/google.server";

export interface LibraryEnv extends DriveEnv {
  LIBRARY_FOLDER_ID?: string;
}

export interface LibraryFolders {
  root: string;
  slides: string | null;
  images: string | null;
}

/**
 * The library's Drive folder id (the parent of `slides/` and `images/`). This is
 * just a folder id, not a secret, so the single source of truth is this constant
 * in the repo: set it here and deploy, no worker var or dashboard needed. The
 * LIBRARY_FOLDER_ID env var, if set, overrides it for a given deployment. Empty
 * in both means the library gallery is off.
 */
const DEFAULT_LIBRARY_FOLDER_ID = "1Ud0p8nexzSB9DhfsIpD7xxUfPRqPEJz7"; // 19d

/** The configured library root id, or "" when the library is off. */
export function libraryRoot(env: LibraryEnv): string {
  return (env.LIBRARY_FOLDER_ID ?? "").trim() || DEFAULT_LIBRARY_FOLDER_ID;
}

/** Resolve the library root and its `slides/` + `images/` subfolders (by name).
 *  Returns null when no library is configured. */
export async function getLibraryFolders(token: string, env: LibraryEnv): Promise<LibraryFolders | null> {
  const root = libraryRoot(env);
  if (!root) return null;
  let slides: string | null = null;
  let images: string | null = null;
  try {
    for (const child of await driveListFolder(token, root)) {
      if (!child.isFolder) continue;
      const n = child.name.toLowerCase();
      if (n === "slides") slides = child.id;
      else if (n === "images") images = child.id;
    }
  } catch {
    return null;
  }
  return { root, slides, images };
}

/** True when fileId lives within the library subtree (the root or a folder under
 *  it). The mandatory gate for id-mode asset / fragment reads, so those endpoints
 *  never become a read-any-Drive-file hole. Walks parents a few hops. */
export async function isInLibrary(token: string, env: LibraryEnv, fileId: string): Promise<boolean> {
  const root = libraryRoot(env);
  if (!root) return false;
  if (fileId === root) return true;
  let id: string | undefined = fileId;
  let guard = 0;
  while (id && guard++ < 6) {
    let parent: string | undefined;
    try {
      parent = (await driveGetMeta(token, id)).parents?.[0];
    } catch {
      return false;
    }
    if (!parent) return false;
    if (parent === root) return true;
    id = parent;
  }
  return false;
}
