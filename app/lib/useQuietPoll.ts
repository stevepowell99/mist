import { useEffect, useRef } from "react";

/**
 * Poll while it is worth polling, and slow down when it is not.
 *
 * Local mode asks the sidecar two questions on a timer: has the file changed,
 * and is there anything to commit. Both are cheap on their own and neither is
 * cheap thirty thousand times. An editor left open overnight ran the dev server
 * at half a core with nobody at the keyboard, because a timer does not know the
 * difference between a document being written and a document being ignored.
 *
 * Three rules, and the second is the one that matters:
 *
 * - Nothing runs while the tab is hidden. A background tab does not need
 *   two-second freshness, and the answer it would get is one nobody reads.
 * - The interval widens while the answer keeps coming back "nothing changed",
 *   doubling from `base` up to `max`.
 * - It snaps back to `base` the moment anything changes, the tab is focused, or
 *   it becomes visible. Coming back to a tab is exactly when an outside change
 *   is most likely to be waiting, so that is when to be quick again.
 *
 * `fn` reports whether it saw a change. Returning false is what earns the
 * slowdown, so a poll that cannot tell should return true and stay fast.
 */
export function useQuietPoll(
  fn: () => boolean | void | Promise<boolean | void>,
  { base, max, enabled = true }: { base: number; max: number; enabled?: boolean },
) {
  // The callback changes identity on most renders; holding it in a ref keeps
  // the timer from being torn down and rebuilt (which would reset the backoff
  // on every keystroke, quietly undoing the whole point).
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let delay = base;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        // Not a reason to speed up or slow down: just wait for the tab to come
        // back, which fires quicken() below.
        arm();
        return;
      }
      let changed: boolean | void = false;
      try {
        changed = await fnRef.current();
      } catch {
        // The sidecar is briefly unreachable. Treat it as no change so a
        // stopped sidecar cannot hold the poll at full speed indefinitely.
      }
      if (stopped) return;
      delay = changed ? base : Math.min(delay * 2, max);
      arm();
    };

    const quicken = () => {
      if (stopped || document.hidden) return;
      delay = base;
      if (timer) clearTimeout(timer);
      void tick();
    };

    arm();
    window.addEventListener("focus", quicken);
    document.addEventListener("visibilitychange", quicken);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", quicken);
      document.removeEventListener("visibilitychange", quicken);
    };
  }, [base, max, enabled]);
}
