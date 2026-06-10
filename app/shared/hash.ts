/**
 * FNV-1a 32-bit hash, used to tell whether the document currently shown matches
 * what was last committed to GitHub. Shared by the client and the agent so both
 * compute the same value over the same serialized markdown.
 */
export function quickHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
