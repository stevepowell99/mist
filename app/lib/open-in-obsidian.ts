import { LOCAL_GMIST_ORIGIN } from "~/shared/constants";

/** True for Ctrl/Cmd+O alone, the Open in Obsidian key in both editors. */
export function isObsidianKey(e: KeyboardEvent): boolean {
  return (e.key === "o" || e.key === "O") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/**
 * Open a file in Obsidian. Only the local gmist knows where the file is on this
 * machine, so this asks it for the `obsidian://` link (routes/local.obsidian.ts),
 * from the deployed site as much as from the local one, then opens the link from
 * this page while the key press still counts as one: Chrome launches an app only
 * from the page the user acted in. Chrome asks "Open Obsidian?" once per site
 * until "Always allow" is ticked; from the deployed site it may first ask to let
 * the page reach this computer.
 */
export async function openInObsidian(fileId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${LOCAL_GMIST_ORIGIN}/local/obsidian?id=${encodeURIComponent(fileId)}`);
  } catch {
    window.alert(`Open in Obsidian needs the local gmist running on this computer (${LOCAL_GMIST_ORIGIN}).`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!body.url) {
    window.alert(`Open in Obsidian: ${body.error ?? `failed (${res.status})`}`);
    return;
  }
  window.location.href = body.url;
}
