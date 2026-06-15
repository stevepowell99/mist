/**
 * Resolve a Ctrl/Cmd+Alt keyboard chord to a canonical lowercase token
 * ("e", "1", "[", "/"), or null if the event is not such a chord.
 *
 * It reads the physical key (e.code) first, so a Windows AltGr layout (where
 * Ctrl+Alt+E emits an accented character and e.key is not "e") and the numpad
 * digits still resolve; it falls back to e.key for anything unmapped.
 */
export function modAltChord(e: KeyboardEvent): string | null {
  // AltGr (common on Windows/UK layouts) can report as the AltGraph modifier
  // rather than altKey, so accept either.
  const alt = e.altKey || (typeof e.getModifierState === "function" && e.getModifierState("AltGraph"));
  if (!(e.ctrlKey || e.metaKey) || !alt) return null;
  const c = e.code;
  if (c.startsWith("Key")) return c.slice(3).toLowerCase(); // KeyE -> "e"
  if (c.startsWith("Digit")) return c.slice(5); // Digit1 -> "1"
  if (c.startsWith("Numpad") && /\d$/.test(c)) return c.slice(-1); // Numpad1 -> "1"
  if (c === "BracketLeft") return "[";
  if (c === "BracketRight") return "]";
  if (c === "Minus") return "-";
  if (c === "Equal") return "=";
  if (c === "Slash") return "/";
  const k = e.key.toLowerCase();
  return k.length === 1 ? k : null;
}
