/**
 * A per-browser choice kept in localStorage: a remembered view, panel or mode.
 * Conveniences only. Storage can be refused (a private window), so a read falls
 * back to the default and a write is allowed to fail.
 */
export function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    // a private window, or storage refused: the default is fine
    return fallback;
  }
}

/** A remembered number, such as a pane width; anything outside min..max reads as the fallback. */
export function rememberedNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // nothing here is worth failing an edit for
  }
}
