/**
 * Whether an outside change to the open file may be taken silently.
 *
 * Following the file is what an editor should do: an agent or another tool
 * rewrites the document and the editor updates in place, no prompt, no fuss.
 * That is right for somebody's new work and wrong for a wipe, and the two are
 * told apart here rather than in the middle of a polling loop.
 *
 * Three reasons to offer the change instead of taking it:
 *
 * - **Local edits.** Anything typed since the last save would be lost.
 * - **A revert.** The incoming version is one this session has already been at,
 *   so the file has been put back rather than moved on. A deploy script
 *   restoring a staged copy is the case that prompted this, on 3 September 2026,
 *   after it cost Steve forty minutes of work.
 * - **A material shrink.** Text has gone. The bounds are low on purpose: the
 *   loss that prompted them was 765 characters out of 55,856, so any rule
 *   phrased only as a percentage would have waved it through.
 */
export const SHRINK_CHARS = 200;
export const SHRINK_RATIO = 0.005;

export interface OutsideChange {
  /** The editor holds edits made since the last load or save. */
  dirty: boolean;
  /** The incoming version is one this session has already loaded or written. */
  reverted: boolean;
  /** Length of the body currently in the editor. */
  currentLength: number;
  /** Length of the body arriving from disk, or null when not yet fetched. */
  incomingLength: number | null;
}

export function shouldOfferRatherThanTake(change: OutsideChange): boolean {
  if (change.dirty || change.reverted) return true;
  if (change.incomingLength === null) return false;
  const lost = change.currentLength - change.incomingLength;
  if (lost <= SHRINK_CHARS) return false;
  return lost / Math.max(change.currentLength, 1) > SHRINK_RATIO;
}
