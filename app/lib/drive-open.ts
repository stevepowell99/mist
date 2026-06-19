/**
 * Shared "open a Drive file in gmist" step, used by the folder sidebar
 * (DriveBrowser) and the Spotlight quick-open palette so the import call and its
 * error handling live in one place. Opening a file is not a constructable URL:
 * the room URL (with its capability key) is minted server-side by /drive/import.
 */

export const SIGN_IN_MSG = "Sign in with Google on the home page to use Drive.";

/** Parse a JSON response, but if the body is not JSON (e.g. a sanitised server
 *  error page), surface the text as a clean error instead of a parse crash. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(text.trim().slice(0, 200) || `request failed (${res.status})`);
  }
}

/** Mint the in-app room URL for a Drive file id. Throws a clean message on a
 *  lapsed session (401) or any server error. */
export async function importDriveFile(id: string): Promise<string> {
  const res = await fetch("/drive/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: id }),
  });
  if (res.status === 401) throw new Error(SIGN_IN_MSG);
  const body = (await readJson(res)) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? "could not open file");
  return body.url;
}
