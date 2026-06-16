import type { Peer } from "~/lib/usePresence";

/**
 * A row of avatars for the other people connected to this doc, read from Yjs
 * awareness. Each shows the peer's initial in their cursor colour; the tooltip
 * names them and, for a deck, the slide they are on. Clicking a peer who is on a
 * slide jumps the deck there (via a window event the slides view listens for).
 */
function initial(name: string): string {
  const t = name.trim();
  return t ? t[0].toUpperCase() : "?";
}

export default function PresenceBar({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 5);
  const extra = peers.length - shown.length;
  return (
    <div className="hidden items-center lg:flex" aria-label="People here">
      {shown.map((p) => (
        <button
          key={p.clientID}
          type="button"
          onClick={() => {
            if (p.slide != null) window.dispatchEvent(new CustomEvent("mist-goto-slide", { detail: p.slide }));
          }}
          title={p.slide != null ? `${p.name} · slide ${p.slide + 1}` : p.name}
          aria-label={p.name}
          className="-ml-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-paper text-[11px] font-semibold text-white shadow-sm first:ml-0"
          style={{ backgroundColor: p.color }}
        >
          {initial(p.name)}
        </button>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-paper bg-muted text-[11px] font-semibold text-paper">
          +{extra}
        </span>
      )}
    </div>
  );
}
