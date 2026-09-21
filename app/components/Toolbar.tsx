import type React from "react";

/**
 * The navbar's shared vocabulary: the glyphs and the segmented toggle that the
 * Mode and View groups are built from.
 *
 * It lives here rather than in either editor because there are two, and they
 * are meant to be one app. They had drifted into looking nothing like each
 * other: the Drive editor drew icon toggles, the local one drew lowercase words
 * in a different order, so the same four views were two different controls
 * depending on which file you happened to have open. Unifying the order and the
 * keyboard chords did not fix that, because neither is visible.
 */

// Stroke-only 18px glyphs so they sit quietly in the bar.
const svg = (paths: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

export const IconEditing = () => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
export const IconSuggesting = () => svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />);
export const IconEditorOnly = () => svg(<><path d="M4 6h16M4 10h16M4 14h10M4 18h10" /></>);
// Live preview: the same lines as the editor icon, but the top one is a heading
// bar, so the pair reads as "source" then "typeset".
export const IconLive = () => svg(<><path d="M4 6h9" strokeWidth="3.5" /><path d="M4 11h16M4 15h16M4 19h10" /></>);
export const IconSplit = () => svg(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16" /></>);
export const IconPreviewOnly = () => svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);
export const IconOutline = () => svg(<>
  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
  <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
</>);
export const IconPresent = () => svg(<>
  <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
  <path d="M10 8.5 14.5 11 10 13.5Z" fill="currentColor" stroke="none" />
</>);
export const IconPrint = () => svg(<>
  <path d="M6 9V2h12v7" />
  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
  <rect x="6" y="14" width="12" height="8" rx="1" />
</>);
export const IconComments = () => svg(<path d="M4 6h16M4 12h16M4 18h16" />);
/** Take this file to the other gmist (local editor only). */
export const IconOnline = () => svg(<>
  <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
  <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
</>);

/** The four exclusive layouts the navbar, keyboard and URL all name. */
export type DocView = "editor" | "live" | "split" | "preview";

/**
 * The view group, in the one order both editors use, with the chord in each
 * tooltip. `omit` drops a view the caller cannot offer (Split is desktop-only).
 */
export const VIEW_BUTTONS: { view: DocView; title: string; Icon: () => React.ReactElement }[] = [
  { view: "editor", title: "Editor only (Ctrl/Cmd+Alt+1)", Icon: IconEditorOnly },
  { view: "live", title: "Live preview (Ctrl/Cmd+Alt+4)", Icon: IconLive },
  { view: "split", title: "Split (Ctrl/Cmd+Alt+2)", Icon: IconSplit },
  { view: "preview", title: "Preview only (Ctrl/Cmd+Alt+3)", Icon: IconPreviewOnly },
];

/** A segmented navbar toggle, kept DRY across the Mode and View groups. */
export function ToolbarToggle({
  active,
  onClick,
  title,
  disabled,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`flex items-center px-3 py-1.5 transition-colors ${
        active ? activeClass : "text-muted hover:bg-border hover:text-ink"
      } ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

/** The bordered, divided shell both segmented groups sit in. */
export function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">{children}</div>
  );
}

/** A plain (non-segmented) navbar action: the icon buttons between the groups. */
export function ToolbarButton({
  onClick,
  href,
  title,
  active,
  children,
}: {
  onClick?: () => void;
  /** Renders an anchor instead, for the actions that open a new tab. */
  href?: string;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const cls = `flex shrink-0 cursor-pointer items-center px-3 transition-colors ${
    active ? "bg-ink text-paper" : "text-muted hover:bg-border hover:text-ink"
  }`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} className={cls}>
      {children}
    </button>
  );
}
