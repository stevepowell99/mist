/**
 * Server-only GitHub helpers.
 *
 * Reads target PUBLIC repos and need no auth: the raw file is fetched over
 * raw.githubusercontent.com (see rawAssetUrl in ./github). Only commit-back
 * needs the fine-grained PAT in env.GITHUB_TOKEN, which must never reach the
 * client, so the write helpers take the token explicitly.
 */
import type { GitHubMeta } from "~/shared/types";
import { rawAssetUrl } from "~/lib/github";

export { parseGitHubFileUrl } from "~/lib/github";

const API = "https://api.github.com";
const UA = "mist-collab-editor";

/** Fetch a public text file's content (no auth). */
export async function fetchPublicText(f: GitHubMeta): Promise<string> {
  const res = await fetch(rawAssetUrl(f, f.path), { headers: { "User-Agent": UA } });
  if (res.status === 404) throw new Error("file not found (is the repo public?)");
  if (!res.ok) throw new Error(`GitHub fetch failed (${res.status})`);
  return res.text();
}

export interface GitHubDirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

/**
 * List a public directory's immediate entries (no auth). Uses the contents API;
 * unauthenticated calls are rate-limited (60/hr per IP), fine for folder
 * navigation. A token could raise the limit later if needed.
 */
export async function fetchPublicDir(
  f: Pick<GitHubMeta, "owner" | "repo" | "branch">,
  dir: string,
): Promise<GitHubDirEntry[]> {
  const path = dir ? `/${encodeURI(dir)}` : "";
  const res = await fetch(
    `${API}/repos/${f.owner}/${f.repo}/contents${path}?ref=${encodeURIComponent(f.branch)}`,
    { headers: { "User-Agent": UA, Accept: "application/vnd.github+json" } },
  );
  if (res.status === 404) throw new Error("folder not found (is the repo public?)");
  if (!res.ok) throw new Error(`GitHub list failed (${res.status})`);
  return (await res.json()) as GitHubDirEntry[];
}

function encodeStringToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Current blob sha for a file, needed to commit an update. */
export async function fetchSha(token: string, f: GitHubMeta): Promise<string> {
  const res = await fetch(
    `${API}/repos/${f.owner}/${f.repo}/contents/${encodeURI(f.path)}?ref=${encodeURIComponent(f.branch)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`could not read file metadata (${res.status})`);
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

/** Commit new text content to a file. Fetches the current sha first. */
export async function commitFile(
  token: string,
  f: GitHubMeta,
  content: string,
  message: string,
): Promise<{ sha: string }> {
  const sha = await fetchSha(token, f);
  const res = await fetch(
    `${API}/repos/${f.owner}/${f.repo}/contents/${encodeURI(f.path)}`,
    {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message,
        content: encodeStringToBase64(content),
        sha,
        branch: f.branch,
      }),
    },
  );
  if (res.status === 409) {
    throw new Error("file changed upstream; reload and retry");
  }
  if (!res.ok) {
    throw new Error(`GitHub commit failed (${res.status})`);
  }
  const body = (await res.json()) as { content: { sha: string } };
  return { sha: body.content.sha };
}
