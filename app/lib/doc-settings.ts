/**
 * Per-file UI settings (the layout you left a file in), persisted in
 * localStorage. Keyed by a STABLE file identity (the Drive file id, or the doc
 * id) so the settings stick to the file across re-imports, which mint a new mist
 * doc id each time. A `_default` entry holds the most-recently-used
 * values, so a file with no saved settings (a new one) inherits your last
 * layout. Theme and the autosave safety toggle are deliberately NOT here; they
 * stay global.
 */
import type { DriveMeta } from "~/shared/types";

export interface DocSettings {
  /** Editor width as a percentage of the split (100 = no split). */
  editorPct?: number;
  /** Whether the Preview pane is showing (with editorPct, this gives the View). */
  showPreview?: boolean;
  /** Slide preview follows the editor cursor (decks). */
  followCursor?: boolean;
  /** Editor cursor follows the deck's slide when you navigate it (decks). */
  followSlide?: boolean;
  /** CriticMarkup delimiters hidden in the editor. */
  cleanView?: boolean;
  /** Comments panel collapsed. */
  asideCollapsed?: boolean;
}

const KEY = "mistDocSettings";
const DEFAULT_ENTRY = "_default";

/** A stable key for a file across re-imports: Drive file id, or the doc id for
 *  an unbacked doc. */
export function docFileKey(drive: DriveMeta | null, docId: string): string {
  if (drive) return `drive:${drive.fileId}`;
  return `doc:${docId}`;
}

function readAll(): Record<string, DocSettings> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? (v as Record<string, DocSettings>) : {};
  } catch {
    return {};
  }
}

/** The settings for a file: its own saved set layered over the most-recent
 *  default, so a new file inherits the last-used layout. */
export function loadDocSettings(fileKey: string): DocSettings {
  const all = readAll();
  return { ...(all[DEFAULT_ENTRY] ?? {}), ...(all[fileKey] ?? {}) };
}

/** Merge a change into the file's settings AND the most-recent default. */
export function saveDocSettings(fileKey: string, patch: DocSettings): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  all[fileKey] = { ...(all[fileKey] ?? {}), ...patch };
  all[DEFAULT_ENTRY] = { ...(all[DEFAULT_ENTRY] ?? {}), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable; settings just won't persist this session
  }
}
