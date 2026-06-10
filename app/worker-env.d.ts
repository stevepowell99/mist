// Secrets set via `wrangler secret put` are not in wrangler.jsonc, so the
// generated Env type does not know about them. Declare them here.
interface Env {
  /** Fine-grained GitHub PAT (contents read/write on selected repos), server-side only */
  GITHUB_TOKEN?: string;
}
