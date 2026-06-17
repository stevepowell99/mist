/**
 * Subsequence fuzzy score for a NAME: all of q's chars must appear in order (so
 * `pnl` finds `panel`). Rewards contiguous runs and word-start hits, so the
 * tightest match ranks first. Returns -1 when q is not a subsequence. Shared by
 * the class picker (cm-classes) and the slash menu (cm-slash) so both rank a
 * direct name hit above a description-only hit by the same weighting.
 */
export function fuzzyName(q: string, text: string): number {
  text = text.toLowerCase();
  let ti = 0,
    score = 0,
    run = 0;
  for (const ch of q) {
    const at = text.indexOf(ch, ti);
    if (at === -1) return -1;
    run = at === ti ? run + 1 : 0;
    score += 1 + run;
    if (at === 0 || /[\s.\-_]/.test(text[at - 1])) score += 3;
    ti = at + 1;
  }
  return score - text.length * 0.05; // gently prefer shorter, tighter names
}

/**
 * Combine a name score and a description hit into one rank, so a direct name hit
 * (>= 0) always outranks a description-only hit. Returns null when neither
 * matches (caller should drop the item). `q` empty means no filtering (0).
 */
export function searchScore(q: string, name: string, detail: string): number | null {
  if (!q) return 0;
  const nameScore = fuzzyName(q, name);
  const inDesc = detail.toLowerCase().includes(q);
  if (nameScore < 0 && !inDesc) return null;
  return (nameScore >= 0 ? nameScore + 20 : 0) + (inDesc ? 3 : 0);
}
