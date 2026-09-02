// User-facing product name. The structural identifiers (worker name, the `mist:`
// frontmatter key, DOM events) stay `mist` on purpose; see CLAUDE.md "Naming".
export const APP_NAME = "gmist";

export function isValidDocumentId(id: string): boolean {
  if (id.length !== 8) return false;
  return /^[a-z0-9]+$/.test(id);
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

/**
 * The room id for a storage file, derived from the file id so the same file
 * always resolves to the same room. Opening a file twice then joins the one
 * room instead of forking a second copy of the content, with its own baseline
 * and its own save loop, that writes back over the first. Used in local mode,
 * where the file id is itself the file's path and a room is never handed to
 * anyone else; Drive rooms keep random ids, so a room id stays unguessable for
 * a file whose id a stranger may know.
 *
 * FNV-1a over the file id, rendered in the same alphabet as a random id so it
 * satisfies isValidDocumentId and is indistinguishable in a URL.
 */
export function documentIdForFile(fileId: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < fileId.length; i++) {
    h ^= BigInt(fileId.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id = ID_CHARS[Number(h % 36n)] + id;
    h /= 36n;
  }
  return id;
}

export function generateDocumentId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

export const USER_COLOURS = [
  { color: "#E57373", light: "#FFCDD2" },
  { color: "#81C784", light: "#C8E6C9" },
  { color: "#64B5F6", light: "#BBDEFB" },
  { color: "#FFB74D", light: "#FFE0B2" },
  { color: "#BA68C8", light: "#E1BEE7" },
  { color: "#4DD0E1", light: "#B2EBF2" },
  { color: "#FF8A65", light: "#FFCCBC" },
  { color: "#AED581", light: "#DCEDC8" },
] as const;

/**
 * Yjs document format version. Bump when the shared type schema changes
 * (e.g. switching CriticMarkup from plain text to ProseMirror marks).
 *
 * v1: plain text with CriticMarkup delimiters, threads in Y.Map("threads")
 * v2: CriticMarkup stored as ProseMirror marks, threads in Y.Map("threads")
 */
export const DOC_FORMAT_VERSION = 2;

/** Protocol message type: Yjs sync */
export const MSG_SYNC = 0;
/** Protocol message type: Yjs awareness */
export const MSG_AWARENESS = 1;
