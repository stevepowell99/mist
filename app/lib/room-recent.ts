/**
 * This browser's list of shared rooms (unbound docs) it has opened, for the
 * home page. Rooms have no server-side index by design: the secret link is the
 * only way in, so each browser remembers its own. The stored key is whichever
 * link was used (edit or suggest), so reopening keeps the same role.
 * Most-recent first, capped.
 */
export interface RecentRoom {
  id: string;
  key: string;
  title: string;
  openedAt: number;
}

const STORE_KEY = "mistRecentRooms";
const CAP = 20;

export function getRecentRooms(): RecentRoom[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function addRecentRoom(room: RecentRoom): void {
  try {
    const list = getRecentRooms().filter((r) => r.id !== room.id);
    list.unshift(room);
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    // No storage (private window, blocked): the list is a convenience only.
  }
}

export function removeRecentRoom(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(getRecentRooms().filter((r) => r.id !== id)));
  } catch {
    // As above.
  }
}

/** The first heading in the text (frontmatter skipped), else "Untitled". */
export function roomTitle(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const m = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].slice(0, 80) : "Untitled";
}
