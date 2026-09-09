import { useCallback, useEffect, useState } from "react";
import { isLocalFileId } from "~/lib/localfs-ids";
import { useQuietPoll } from "~/lib/useQuietPoll";

type GitInfo = { repo: boolean; dirty: boolean; branch: string | null };

/**
 * Commit the file you are editing, without leaving the editor.
 *
 * Uncommitted work in a repo an agent is using is the fragile thing: `git
 * checkout --` discards it, a session rewind overwrites it, a whole-file write
 * from an old copy replaces it. A commit is out of reach of all three, so the
 * cheapest protection is to make committing a click rather than a trip to a
 * terminal.
 *
 * Local files only. A Drive document has no working tree, and the button hides
 * itself for a file that is not in a repo.
 *
 * The sidecar commits by itself a minute after the writing stops. This is the
 * same commit, taken now, for the moment you want the work safe before doing
 * something else to it.
 */
export default function CommitButton({
  fileId,
  unsaved,
  saveNow,
}: {
  fileId: string | undefined;
  /** The buffer holds something not yet on disk, so save before committing. */
  unsaved: boolean;
  saveNow: () => void;
}) {
  const local = !!fileId && isLocalFileId(fileId);

  const [info, setInfo] = useState<GitInfo>({ repo: false, dirty: false, branch: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!local || !fileId) return false;
    try {
      const res = await fetch(`/local/git?id=${encodeURIComponent(fileId)}`);
      if (!res.ok) return false;
      const next = (await res.json()) as GitInfo;
      let moved = false;
      setInfo((prev) => {
        moved = prev.repo !== next.repo || prev.dirty !== next.dirty || prev.branch !== next.branch;
        return moved ? next : prev;
      });
      return moved;
    } catch {
      // the sidecar is briefly unreachable; the next poll tries again
      return false;
    }
  }, [local, fileId]);

  // Follow the file's git state rather than asking once: an agent committing or
  // reverting it underneath changes whether there is anything here to commit.
  //
  // This is the expensive poll of the two. Each answer costs the sidecar a git
  // process, and process creation on Windows is slow and gets inspected by
  // antivirus on the way, so a five-second timer left running overnight is most
  // of what made the dev server sit at half a core with nobody typing. It now
  // sleeps with the tab and widens to a minute while the answer keeps coming
  // back the same.
  useEffect(() => {
    if (local) void refresh();
  }, [local, refresh]);
  useQuietPoll(refresh, { base: 5000, max: 60000, enabled: local });

  const commit = useCallback(async () => {
    if (!fileId || busy) return;
    setBusy(true);
    setNote(null);
    try {
      // Save first, so the commit is of what is on the screen rather than of
      // whatever the last autosave happened to catch.
      if (unsaved) {
        saveNow();
        await new Promise((r) => setTimeout(r, 400));
      }
      const res = await fetch(`/local/git?id=${encodeURIComponent(fileId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { committed?: boolean; hash?: string; reason?: string; error?: string };
      setNote(body.error ?? (body.committed ? `Committed ${body.hash}` : body.reason ?? "Nothing to commit"));
      void refresh();
    } catch {
      setNote("Could not reach git");
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 4000);
    }
  }, [fileId, busy, unsaved, saveNow, refresh]);

  if (!local || !info.repo) return null;

  return (
    <button
      type="button"
      onClick={commit}
      disabled={busy || (!info.dirty && !unsaved)}
      title={
        note ??
        (info.dirty || unsaved
          ? `Commit this file to ${info.branch ?? "the current branch"}. Only this file: anything else staged in the repo is left alone.`
          : "Nothing to commit; this file matches the last commit.")
      }
      className={`flex h-full items-center gap-2 px-3 text-sm uppercase tracking-wider transition-colors ${
        info.dirty || unsaved
          ? "cursor-pointer text-muted hover:bg-border hover:text-ink"
          : "cursor-default text-muted opacity-40"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          info.dirty || unsaved ? "bg-amber-500" : "bg-border"
        }`}
      />
      {note ?? (busy ? "Committing…" : "Commit")}
    </button>
  );
}
