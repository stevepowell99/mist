import { useEffect, useState } from "react";

/** Long enough to outlast a React remount, short enough to feel immediate. */
const SLOW_MS = 400;

/**
 * Whether this window may touch the file.
 *
 *  - `waiting`: we have asked and not been answered. Do nothing at all, and show
 *    nothing: this is the ordinary first moment of every open, and a window that
 *    read the file here would be reading one somebody else is editing.
 *  - `held`: ours. Read, poll and write.
 *  - `blocked`: another window has it, and has had it long enough that saying so
 *    is not a flicker.
 */
export type FileLock = "waiting" | "held" | "blocked";

/**
 * One window per file.
 *
 * Two windows on one file are two buffers, and the second to save wins whatever
 * the first was doing; a minimised window is the worst case, because it is still
 * saving and you cannot see it. The conditional write cannot prevent this on its
 * own: it refuses the stale save, but once that window's poll adopts the newer
 * version its baseline is current again and its older text follows with nothing
 * left to refuse. That is what happened on 8 September 2026 at 13:12.
 *
 * A Web Lock is the right instrument. The browser holds it for as long as the
 * tab lives and releases it if the tab dies, so there is no stale lock to clear.
 * It is requested normally rather than with `ifAvailable`, so it QUEUES: asking
 * whether it is free and answering at once was wrong twice over, because React
 * mounts an effect, tears it down and mounts it again, so the second request
 * raced the tab's own release and declared the file open elsewhere when nothing
 * was, and because a genuine second window, once told, stayed told after the
 * first was closed.
 *
 * The key is the file, not the route, so a file open at /edit/<id> and the same
 * file open at /docs/<id> exclude each other. They are two editors over one
 * file, which is the case this exists for.
 *
 * `blocked` and `waiting` are separate answers because they want opposite
 * treatment: one is shown to the user and the other must never be, while both
 * have to stop the file being touched. Collapsing them into a boolean is how a
 * second window came to read a file it had been refused.
 */
export function useFileLock(fileId: string): FileLock {
  // No Web Locks means no way to ask, and refusing to open every file is a worse
  // answer than the hazard. Decided here so the rest of the file has three
  // states rather than four.
  const supported = typeof navigator !== "undefined" && !!navigator.locks;
  const [lock, setLock] = useState<FileLock>(supported ? "waiting" : "held");

  useEffect(() => {
    if (!supported) return;
    let release = () => {};
    let cancelled = false;
    const slow = setTimeout(() => {
      if (!cancelled) setLock("blocked");
    }, SLOW_MS);

    void navigator.locks.request(
      `gmist-file:${fileId}`,
      () =>
        new Promise<void>((resolve) => {
          clearTimeout(slow);
          if (cancelled) {
            resolve();
            return;
          }
          setLock("held");
          release = resolve; // held until this tab lets go
        }),
    );

    return () => {
      cancelled = true;
      clearTimeout(slow);
      release();
    };
  }, [fileId, supported]);

  return lock;
}
