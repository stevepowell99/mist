/**
 * Locally-remembered list of files opened from Drive, so the browser panel can
 * show something instantly on open (before the network responds) and keep a
 * quick-access list at the bottom. Most-recent first, capped.
 */
export interface RecentItem {
  id: string;
  name: string;
  path?: string;
}

const STORE_KEY = "mistDriveRecentOpened";
const CAP = 12;

export function getRecentOpened(): RecentItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function addRecentOpened(item: RecentItem): void {
  if (typeof localStorage === "undefined") return;
  const list = getRecentOpened().filter((r) => r.id !== item.id);
  list.unshift(item);
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, CAP)));
}
