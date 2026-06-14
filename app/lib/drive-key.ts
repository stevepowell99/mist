/**
 * Client-side holder for the Drive access passphrase (interim gate, see
 * drive-auth.server.ts). Stored in localStorage so it is entered once per
 * browser, sent with every /drive/* request. Replaced by Google sign-in later.
 */
const STORE_KEY = "mistDriveKey";

export function getDriveKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORE_KEY);
}

/** Read the stored key, or prompt for it once and store it. */
export function ensureDriveKey(): string | null {
  let key = getDriveKey();
  if (!key && typeof window !== "undefined") {
    key = window.prompt("Drive access passphrase") || "";
    if (key) localStorage.setItem(STORE_KEY, key);
  }
  return key || null;
}

/** Forget the stored key (call after a 401 so the next try re-prompts). */
export function clearDriveKey(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORE_KEY);
}
