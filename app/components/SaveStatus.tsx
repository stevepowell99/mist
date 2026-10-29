import { useEffect } from "react";
import { isLocalFileId } from "~/lib/localfs-ids";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Header indicator for backend-bound documents (Drive). Saving is live: edits
 * flush to Drive on a short debounce, so this shows "Saving…" while edits are in
 * flight and the steady state "Synced" (this copy matches Drive) once the relay
 * confirms the write. A click flushes immediately. When the file was changed
 * elsewhere and nothing is unsaved here, the relay now adopts the Drive version
 * automatically (Drive is the live truth), so the "Load Drive version" prompt is
 * only a fallback. Only a genuine clash (unsaved edits here AND a diverged Drive
 * file) forks a recovery copy ("Kept a copy") and pauses auto-save. Also warns
 * before closing with unsaved edits.
 */
export default function SaveStatus() {
  const { backed, unsaved, conflict, upstreamChanged, reloadFromDrive, saveNow, forkedNotice, clearForkedNotice, drive } = useDocument();
  // A local file has not "changed in Drive", and saying so sent Steve looking
  // in the wrong place more than once.
  const local = !!drive?.fileId && isLocalFileId(drive.fileId);
  const where = local ? "on disk" : "in Drive";

  useEffect(() => {
    if (!unsaved && !conflict) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved, conflict]);

  if (!backed) return null;

  // A divergent Drive version (an external change, or a stale re-upload) was
  // preserved as a sibling file so nothing was lost; the editor kept your text.
  // Click to dismiss once you have noted the copy.
  if (forkedNotice !== null) {
    return (
      <SaveBadge
        state="kept"
        label="Kept a copy"
        onClick={clearForkedNotice}
        title={
          forkedNotice
            ? `Drive also held a different version of this file. Your text was kept; the other version was saved alongside as "${forkedNotice}". Click to dismiss.`
            : "Drive also held a different version of this file. Your text was kept; the other version was saved alongside in the same folder. Click to dismiss."
        }
      />
    );
  }

  // The Drive file changed and nothing is unsaved here. Could be a genuine edit
  // elsewhere or a stale re-upload, so offer a one-click load rather than
  // adopting it silently. Any unsaved edits are snapshotted to a recovery copy
  // before the body is replaced, so the reload can never lose work.
  if (upstreamChanged) {
    return (
      <SaveBadge
        state="changed"
        label={local ? "File changed on disk — load it" : "Load Drive version"}
        onClick={reloadFromDrive}
        title={`This file changed ${where} while you were editing. Click to load that version. Any unsaved edits here are saved alongside as a recovery copy first, so nothing is lost.`}
      />
    );
  }

  // The Drive file diverged from our last save. gmist keeps retrying in the
  // background (a transient Drive-for-Desktop churn self-heals), so this often
  // clears on its own. If it is a real external edit it persists; clicking loads
  // the Drive version, snapshotting any unsaved edits to a recovery copy first.
  if (conflict) {
    return (
      <SaveBadge
        state="conflict"
        label="Conflict"
        onClick={reloadFromDrive}
        title="This file was also changed in Obsidian/Drive. gmist will not overwrite it and keeps your edits in this session, retrying automatically in case the change was a transient Drive sync blip. If it persists it is a real external edit: click to load the Drive version (your unsaved edits are saved alongside as a recovery copy first)."
      />
    );
  }

  return unsaved ? (
    <SaveBadge state="saving" label="Saving…" onClick={saveNow} title="Saving to Drive. Click to save now." />
  ) : (
    <SaveBadge
      state="saved"
      label="Synced"
      onClick={saveNow}
      title="In sync with Drive (this copy matches the file in Drive)"
    />
  );
}

/** What a save indicator can say, in either editor. */
export type SaveState = "opening" | "saved" | "unsaved" | "saving" | "changed" | "conflict" | "kept" | "error";

/**
 * The save indicator both editors draw: the Drive editor through SaveStatus
 * above, the local editor from its own file sync. Only the look lives here; each
 * editor decides the state, the words and what a click does, because a Drive
 * room and a file on disk fail in different ways.
 */
export function SaveBadge({
  state,
  label,
  title,
  onClick,
}: {
  state: SaveState;
  label: string;
  title: string;
  onClick?: () => void;
}) {
  const look =
    state === "changed"
      ? "upstream-flash font-semibold"
      : state === "conflict" || state === "kept" || state === "error"
        ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25"
        : state === "unsaved" || state === "saving"
          ? "text-coral hover:bg-coral/10"
          : "text-muted hover:bg-border";
  const mark =
    state === "saved" ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ) : state === "opening" ? null : (
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          state === "changed" ? "bg-current" : state === "unsaved" || state === "saving" ? "bg-coral" : "bg-amber-500"
        }`}
      />
    );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      aria-label={label}
      className={`flex h-full items-center gap-2 whitespace-nowrap px-3 text-sm uppercase tracking-wider transition-colors ${look} ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {mark}
      {label}
    </button>
  );
}
