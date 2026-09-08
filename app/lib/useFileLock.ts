import { useEffect, useState } from "react";

/** Long enough to outlast a React remount, short enough to feel immediate. */
const SLOW_MS = 400;

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
 * The answer starts clear rather than locked out, so an ordinary open does not
 * flash a warning while the lock is being taken. A save path that must not
 * re-subscribe on it mirrors it into a ref of its own.
 */
export function useFileLock(fileId: string) {
  const [lockedOut, setLockedOut] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.locks) return;
    let release = () => {};
    let cancelled = false;
    const slow = setTimeout(() => {
      if (!cancelled) setLockedOut(true);
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
          setLockedOut(false);
          release = resolve; // held until this tab lets go
        }),
    );

    return () => {
      cancelled = true;
      clearTimeout(slow);
      release();
    };
  }, [fileId]);

  return lockedOut;
}
