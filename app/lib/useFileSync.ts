import { useCallback, useEffect, useRef, useState } from "react";
import { useFileLock } from "./useFileLock";
import { useQuietPoll } from "./useQuietPoll";
import { shouldOfferRatherThanTake } from "./outside-change";

/** How often to ask whether the file changed, and how slow that may get while
 *  nothing is happening. Bounded low on purpose: noticing that an agent or
 *  Obsidian changed the file underneath you is the promise local mode makes. */
const POLL_MS = 1000;
const POLL_MAX_MS = 10000;
/** How long after the typing stops before the buffer is written. */
const SAVE_AFTER_MS = 1000;

/**
 * The buffer, described in the only four terms this file needs.
 *
 * A local editor is a file, a buffer, and the rules that keep them honest. The
 * rules are the same whichever editor it is; the buffer is not. One holds a
 * CodeMirror document that is the file's bytes, the other a Y.Text carrying the
 * body with its comment threads in a separate map, so "what does the buffer
 * hold" and "what would a save write" are different questions there and the same
 * question here. Everything that differs between the two editors is behind this
 * interface, and nothing that differs leaks past it.
 */
export interface FileSyncBuffer {
  /** The file's text as this buffer would hold it, so the two are comparable.
   *  Identity for an editor whose buffer is the file. */
  normalise(text: string): string;
  /** What the buffer holds now, in the same terms as `normalise`. Null before
   *  the first seed, which is how "not ready" is said. */
  held(): string | null;
  /** Put the file's content into the buffer. `first` on the initial seed, where
   *  an editor may want to build itself rather than patch what is there. */
  put(text: string, first: boolean): void;
  /** The bytes a save would write. Null when there is nothing to write. */
  serialise(): string | null;
}

/** What the sync layer has to tell the editor. Every one of these is a thing
 *  that happened to the file, never a thing to do about it: what to show is the
 *  editor's business, and the two editors show it differently. */
export interface FileSyncEvents {
  /** The file changed elsewhere and the change has been taken. */
  onAdopted?: (text: string) => void;
  /** The file changed elsewhere and the change has NOT been taken, because
   *  taking it would lose something. `why` says which rule fired. */
  onOffered?: (why: OfferReason) => void;
  /** A save landed. */
  onSaved?: (written: string) => void;
  /** A save was refused because the file moved under us. */
  onConflict?: () => void;
  /** The sidecar could not be reached, or refused for another reason. */
  onError?: (message: string) => void;
}

export type OfferReason = "dirty" | "reverted" | "shrank";

/**
 * A file on disk, and a buffer in this tab that is a view of it.
 *
 * This is the whole of the contract both local editors keep, in one place
 * because keeping it twice is what went wrong. Three fixes in three days landed
 * in one editor and not the other: the outside-change guard, the idle-poll
 * backoff, and the window lock. Each was written once, worked, and left the
 * editor people actually use untouched, because there was no shared thing to
 * write it into.
 *
 * The contract:
 *
 *  - **Read the file, and remember the version read.** Every write carries that
 *    version, so a file that moved underneath is refused rather than overwritten.
 *  - **Poll.** Something else writing the file is the normal case here, not the
 *    exception: an agent, Obsidian, a git checkout, Drive for Desktop.
 *  - **Follow the file when following is safe, and ask when it is not.** Taking
 *    somebody's new work silently is what an editor should do. Taking a revert
 *    or a wipe silently is how a morning disappears with nothing said.
 *  - **Never resolve a divergence.** Refuse, keep what is here, say so.
 *  - **One window per file**, because two buffers over one file is the same
 *    problem wearing a different hat.
 */
export function useFileSync(fileId: string, buffer: FileSyncBuffer, events: FileSyncEvents = {}) {
  const [ready, setReady] = useState(false);
  const lock = useFileLock(fileId);
  const held = lock === "held";
  const alreadyOpen = lock === "blocked";

  /** The version this tab loaded or last wrote: the baseline every write
   *  carries, and null until the first read lands. */
  const version = useRef<string | null>(null);
  /** Every version this tab has loaded or written. A change arriving on one of
   *  these is the file being put back to a state we have already been at, which
   *  is a revert rather than somebody's new work. */
  const seen = useRef(new Set<string>());
  /** What the buffer held at the last load or save. Anything else means the
   *  user has typed since. */
  const clean = useRef<string | null>(null);
  /** The version we have already offered, so a change the user has declined is
   *  announced once rather than on every poll. */
  const warned = useRef<string | null>(null);
  /** Stop writing once the file has moved under us. The user has a choice to
   *  make, and retrying only buries it. */
  const conflicted = useRef(false);
  /** Read by the save path, which must not re-subscribe when the lock changes.
   *  Starts refusing, so nothing writes before the lock has answered. */
  const lockedOut = useRef(true);
  /** One write at a time, carrying only the newest content: a save arriving
   *  while another is in flight replaces it rather than queueing behind it. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  // Held in refs so a re-render does not tear down the poll or the save timer.
  const buf = useRef(buffer);
  const evt = useRef(events);
  useEffect(() => {
    buf.current = buffer;
    evt.current = events;
  });

  useEffect(() => {
    lockedOut.current = !held;
  }, [held]);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  const url = useCallback(
    (extra = "") => `/local/doc?id=${encodeURIComponent(fileId)}${extra}`,
    [fileId],
  );

  const read = useCallback(async () => {
    const res = await fetch(url(), { cache: "no-store" });
    if (!res.ok) throw new Error("could not read the file");
    return (await res.json()) as { text: string; version: string | null };
  }, [url]);

  /** Take the file's content, and rebaseline on it. */
  const take = useCallback(
    (text: string, at: string | null, first: boolean) => {
      buf.current.put(text, first);
      version.current = at;
      if (at) seen.current.add(at);
      clean.current = buf.current.held();
      warned.current = null;
    },
    [],
  );

  /** The first read. Separate from the poll because an editor may need to build
   *  itself around the content rather than patch a buffer that already exists. */
  useEffect(() => {
    if (!held) return;
    let cancelled = false;
    void (async () => {
      try {
        const first = await read();
        if (cancelled || stopped.current) return;
        take(first.text, first.version, true);
        setReady(true);
      } catch {
        if (!cancelled) evt.current.onError?.("Could not open the file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [read, take, held]);

  const write = useCallback(async () => {
    const content = pending.current;
    pending.current = null;
    if (content === null || conflicted.current || lockedOut.current) return;
    try {
      const expected = version.current ? `&expected=${encodeURIComponent(version.current)}` : "";
      const res = await fetch(url(expected), {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: content,
        cache: "no-store",
      });
      if (res.status === 409) {
        conflicted.current = true;
        evt.current.onConflict?.();
        return;
      }
      if (!res.ok) {
        evt.current.onError?.("Could not write the file.");
        return;
      }
      const body = (await res.json()) as { version: string | null };
      version.current = body.version;
      if (body.version) seen.current.add(body.version);
      clean.current = buf.current.held();
      evt.current.onSaved?.(content);
    } catch {
      evt.current.onError?.("The local file service is not reachable.");
    }
  }, [url]);

  /** Write now. Without `content` the buffer is asked what it holds, which is
   *  what an editor whose buffer is the file wants; the other one is pushed its
   *  serialisation from above and passes it in. */
  const save = useCallback(
    (content?: string) => {
      if (conflicted.current || lockedOut.current) return;
      const next = content ?? buf.current.serialise();
      if (next === null) return;
      pending.current = next;
      chain.current = chain.current.then(write);
    },
    [write],
  );

  /** The user typed. Save once the typing stops. */
  const touched = useCallback(() => {
    if (conflicted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), SAVE_AFTER_MS);
  }, [save]);

  /**
   * Has the file changed, and may the change be taken?
   *
   * The version is one hash, so the ordinary answer costs one small request.
   * The content is fetched only once the version says something happened, and
   * the length of what is arriving is what decides whether text has gone.
   */
  const check = useCallback(async () => {
    if (stopped.current || conflicted.current) return false;
    try {
      const res = await fetch(url("&stat=1"), { cache: "no-store" });
      if (!res.ok) return false;
      const { version: onDisk } = (await res.json()) as { version: string | null };
      if (stopped.current || !onDisk || onDisk === version.current) return false;

      const next = await read();
      if (stopped.current) return true;
      const current = buf.current.held();
      if (current === null) return true; // not seeded yet; the first read owns it
      const incoming = buf.current.normalise(next.text);

      const offer = shouldOfferRatherThanTake({
        dirty: clean.current !== null && current !== clean.current,
        reverted: next.version ? seen.current.has(next.version) : false,
        currentLength: current.length,
        incomingLength: incoming.length,
      });

      if (offer) {
        if (warned.current !== next.version) {
          warned.current = next.version;
          evt.current.onOffered?.(
            clean.current !== null && current !== clean.current
              ? "dirty"
              : next.version && seen.current.has(next.version)
                ? "reverted"
                : "shrank",
          );
        }
        return true;
      }
      take(next.text, next.version, false);
      evt.current.onAdopted?.(next.text);
      return true;
    } catch {
      // the sidecar is briefly unreachable; the next tick tries again
      return false;
    }
  }, [url, read, take]);

  useQuietPoll(check, { base: POLL_MS, max: POLL_MAX_MS, enabled: ready && held });

  /**
   * Leaving must write.
   *
   * `sendBeacon` survives the page being torn down, which a fetch started at
   * that moment does not. It cannot read the reply, so a write refused here is
   * refused in silence: the conditional write still protects the file, but the
   * user is not told. That is the price of saving at all on the way out, and it
   * is only reached for a buffer that is dirty when the tab closes.
   */
  useEffect(() => {
    const flush = () => {
      if (conflicted.current || lockedOut.current) return;
      const content = buf.current.serialise();
      const current = buf.current.held();
      if (content === null || current === null || current === clean.current) return;
      const expected = version.current ? `&expected=${encodeURIComponent(version.current)}` : "";
      navigator.sendBeacon?.(
        url(expected),
        new Blob([content], { type: "text/markdown; charset=utf-8" }),
      );
    };
    const onHidden = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHidden);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [url]);

  /** Take what is on disk, discarding the offer. The editor is expected to have
   *  kept a copy of the buffer first; `saveRecovery` is how. */
  const takeDisk = useCallback(async () => {
    try {
      const next = await read();
      take(next.text, next.version, false);
      conflicted.current = false;
      evt.current.onAdopted?.(next.text);
    } catch {
      evt.current.onError?.("Could not load the file from disk.");
    }
  }, [read, take]);

  /** Keep a copy of the buffer beside the file, before anything replaces it. */
  const saveRecovery = useCallback(async () => {
    const content = buf.current.serialise();
    if (content === null) return null;
    try {
      const res = await fetch(`/local/recovery?id=${encodeURIComponent(fileId)}`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: content,
        cache: "no-store",
      });
      const body = (await res.json()) as { saved?: string };
      return body.saved ?? null;
    } catch {
      return null; // the copy is best effort; whatever prompted it still stands
    }
  }, [fileId]);

  /** Stop writing. The file has moved under us and the user has a choice to
   *  make; every further save would be refused and would bury the question. */
  const halt = useCallback(() => {
    conflicted.current = true;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { ready, alreadyOpen, save, touched, check, takeDisk, saveRecovery, halt };
}
