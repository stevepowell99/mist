import { LOCAL_GMIST_ORIGIN } from "~/shared/constants";

/** True for Ctrl/Cmd+O alone, the Open in Obsidian key in both editors. */
export function isObsidianKey(e: KeyboardEvent): boolean {
  return (e.key === "o" || e.key === "O") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/**
 * Open a file in Obsidian. Only the local gmist knows where the file is on this
 * machine, so this asks it (routes/local.obsidian.ts), from the deployed site as
 * much as from the local one. A new tab, so the editor never navigates away; it
 * is handed straight to Obsidian, and shows the reason if the file is not here.
 */
export function openInObsidian(fileId: string): void {
  const w = window.open(`${LOCAL_GMIST_ORIGIN}/local/obsidian?id=${encodeURIComponent(fileId)}`, "_blank");
  if (w) w.opener = null;
}
