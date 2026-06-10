import type { GitHubMeta } from "~/shared/types";

const RAW = "https://raw.githubusercontent.com";

/**
 * Parse a GitHub file URL into its parts.
 * Accepts:
 *   https://github.com/{owner}/{repo}/blob/{branch}/{path...}
 *   https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path...}
 */
export function parseGitHubFileUrl(input: string): GitHubMeta | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const segs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (url.hostname === "github.com") {
    if (segs.length < 5 || segs[2] !== "blob") return null;
    const [owner, repo, , branch, ...rest] = segs;
    const path = rest.join("/");
    if (!owner || !repo || !branch || !path) return null;
    return { owner, repo, branch, path };
  }

  if (url.hostname === "raw.githubusercontent.com") {
    if (segs.length < 4) return null;
    const [owner, repo, branch, ...rest] = segs;
    const path = rest.join("/");
    if (!owner || !repo || !branch || !path) return null;
    return { owner, repo, branch, path };
  }

  return null;
}

/** Directory portion of a file path ("docs/a/b.md" gives "docs/a"). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolve a markdown-relative asset path against the document's directory. */
export function resolveAssetPath(docPath: string, assetPath: string): string {
  const base = dirOf(docPath).split("/").filter(Boolean);
  for (const seg of assetPath.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return base.join("/");
}

/** Public raw URL for an asset path already resolved against the repo root. */
export function rawAssetUrl(
  f: Pick<GitHubMeta, "owner" | "repo" | "branch">,
  resolvedPath: string,
): string {
  const encoded = resolvedPath.split("/").map(encodeURIComponent).join("/");
  return `${RAW}/${f.owner}/${f.repo}/${f.branch}/${encoded}`;
}

// Markdown image: ![alt](url). HTML image: <img ... src="url">
const MD_IMAGE_RE = /(!\[[^\]]*\]\()([^)\s]+)(\)|\s)/g;
const HTML_IMAGE_RE = /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi;

/** Is this an absolute URL or root-relative path we should leave alone? */
function isAbsolute(url: string): boolean {
  return /^[a-z]+:\/\//i.test(url) || url.startsWith("/") || url.startsWith("data:") || url.startsWith("#");
}

/**
 * Rewrite relative image URLs (markdown and HTML syntax) to public
 * raw.githubusercontent.com URLs so images in a GitHub-imported doc render
 * in Preview.
 */
export function rewriteImageUrls(markdown: string, github: GitHubMeta): string {
  const rewrite = (whole: string, prefix: string, url: string, suffix: string) => {
    if (isAbsolute(url)) return whole;
    const resolved = resolveAssetPath(github.path, url);
    return `${prefix}${rawAssetUrl(github, resolved)}${suffix}`;
  };
  return markdown.replace(MD_IMAGE_RE, rewrite).replace(HTML_IMAGE_RE, rewrite);
}
