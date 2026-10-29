import type React from "react";
import { Link } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { APP_NAME } from "~/shared/constants";
import { useTheme, type Theme } from "~/lib/useTheme";
import {
  IconComments,
  IconMore,
  IconOutline,
  IconPresent,
  ModeToggle,
  ToolbarButton,
  ToolbarGroup,
  ToolbarToggle,
  VIEW_BUTTONS,
  type DocView,
} from "~/components/Toolbar";

/** One entry in the navbar's More menu: an action, or a link opening a new tab. */
export interface NavMenuItem {
  label: string;
  /** The keyboard chord, shown beside the label. */
  keys?: string;
  onSelect?: () => void;
  href?: string;
  title?: string;
}

/**
 * The navbar of a document, the one both editors draw: the Drive editor
 * (`docs.$id`) and the local one (`PlainEditor`). The two had grown separate
 * headers that disagreed about what went where, so the layout now lives here
 * and each editor passes only what it has. Left to right:
 *
 * - home, then the panel toggle for the left side (the Drive folder browser,
 *   the outline), each above the panel it opens;
 * - what the document is: Deck or Doc, the folder, the name, and its save state;
 * - how you are working on it: Editing or Suggesting, and the four views;
 * - what you can do with it: Present (decks), Share, and a More menu holding
 *   the occasional actions (print, the library, the colour theme);
 * - who is here, then the comments panel toggle, above the panel it opens.
 *
 * What differs between the editors is only what really differs, and it arrives
 * as a slot: a Drive file has a Share menu, a local file a link to the online
 * gmist; a Drive room has people and a connection, a local file has git.
 */
export default function DocNavbar({
  headerRef,
  homeHref,
  folderButton,
  outline,
  deck,
  folder,
  title,
  status,
  mode,
  view,
  onPresent,
  share,
  menu,
  people,
  comments,
}: {
  headerRef?: React.Ref<HTMLElement>;
  homeHref: string;
  /** The Drive folder browser's own trigger, which carries its panel. */
  folderButton?: React.ReactNode;
  outline: { open: boolean; onToggle: () => void };
  deck: boolean;
  /** The folder the file sits in, and what clicking it does (if anything). */
  folder?: { label: string; onClick?: () => void } | null;
  title: string;
  /** The save badge, plus anything that belongs beside it (git, a note). */
  status: React.ReactNode;
  mode: { value: "edit" | "suggest"; onToggle: () => void; locked?: boolean };
  view: { value: DocView; onChange: (v: DocView) => void; allowSplit: boolean };
  onPresent?: () => void;
  share: React.ReactNode;
  menu: NavMenuItem[];
  people?: React.ReactNode;
  comments: { open: boolean; peek?: boolean; onToggle: () => void };
}) {
  return (
    <header ref={headerRef} className="flex h-11 shrink-0 items-stretch border-b border-border text-sm">
      <Link
        to={homeHref}
        className="flex shrink-0 items-center bg-ink px-4 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        {APP_NAME}
      </Link>
      {folderButton}
      <div className="flex shrink-0 items-stretch border-r border-border">
        <ToolbarButton
          onClick={outline.onToggle}
          title={`${deck ? "Slide list" : "Outline"} (Ctrl/Cmd+Alt+D)`}
          active={outline.open}
        >
          <IconOutline />
        </ToolbarButton>
      </div>

      <div className="flex min-w-0 grow items-center gap-2 px-3">
        <span
          className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs uppercase tracking-wider text-muted sm:inline-block"
          title={deck ? "Slide deck (format: revealjs)" : "Document"}
        >
          {deck ? "Deck" : "Doc"}
        </span>
        {folder && (
          <span className="hidden min-w-0 shrink items-center gap-2 sm:flex">
            {folder.onClick ? (
              <button
                type="button"
                onClick={folder.onClick}
                title={`Open folder: ${folder.label}`}
                className="max-w-[16rem] cursor-pointer truncate text-muted opacity-70 hover:underline hover:opacity-100"
              >
                {folder.label}
              </button>
            ) : (
              <span className="max-w-[16rem] truncate text-muted opacity-70" title={folder.label}>
                {folder.label}
              </span>
            )}
            <span className="text-muted opacity-50">/</span>
          </span>
        )}
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
      </div>
      <div className="flex shrink-0 items-stretch">{status}</div>

      <div className="flex shrink-0 items-center gap-2 border-l border-border px-2">
        <ModeToggle mode={mode.value} onToggle={mode.onToggle} locked={mode.locked} />
        <ToolbarGroup>
          {VIEW_BUTTONS.map(({ view: v, title: t, Icon }) =>
            // Split needs the width for two panes, so a narrow screen drops it.
            v === "split" && !view.allowSplit ? null : (
              <ToolbarToggle
                key={v}
                active={view.value === v}
                onClick={() => view.onChange(v)}
                title={t}
                activeClass={v === "preview" ? "bg-emerald-600 text-paper" : "bg-ink text-paper"}
              >
                <Icon />
              </ToolbarToggle>
            ),
          )}
        </ToolbarGroup>
      </div>

      <div className="flex shrink-0 items-stretch border-l border-border">
        {onPresent && (
          <ToolbarButton onClick={onPresent} title="Present (Ctrl/Cmd+Alt+P)">
            <IconPresent />
            <span className="hidden xl:inline">Present</span>
          </ToolbarButton>
        )}
        {share}
        <MoreMenu items={menu} />
      </div>
      {people && <div className="hidden shrink-0 items-stretch border-l border-border lg:flex">{people}</div>}
      <div className="flex shrink-0 items-stretch border-l border-border">
        <ToolbarButton
          onClick={comments.onToggle}
          title="Comments and suggested edits (Ctrl/Cmd+Alt+C)"
          active={comments.open}
        >
          <span className={comments.peek && !comments.open ? "text-ink" : undefined}>
            <IconComments />
          </span>
        </ToolbarButton>
      </div>
    </header>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/** The occasional actions, and the colour theme, behind one button. */
function MoreMenu({ items }: { items: NavMenuItem[] }) {
  const { theme, setTheme } = useTheme();
  const row = "flex w-full cursor-pointer items-center gap-6 px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title="More: print, theme and other actions"
          aria-label="More actions"
          className="flex shrink-0 cursor-pointer items-center px-3 text-muted transition-colors hover:bg-border hover:text-ink data-[state=open]:bg-border data-[state=open]:text-ink"
        >
          <IconMore />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-50 min-w-56 border border-border bg-paper py-1" align="end" sideOffset={4}>
          {items.map((it) =>
            it.href ? (
              <DropdownMenu.Item key={it.label} asChild>
                <a href={it.href} target="_blank" rel="noopener noreferrer" title={it.title} className={row}>
                  <span>{it.label}</span>
                  {it.keys && <span className="ml-auto text-xs text-muted">{it.keys}</span>}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={it.label} onSelect={it.onSelect} title={it.title} className={row}>
                <span>{it.label}</span>
                {it.keys && <span className="ml-auto text-xs text-muted">{it.keys}</span>}
              </DropdownMenu.Item>
            ),
          )}
          <DropdownMenu.Separator className="my-1 border-t border-border" />
          <DropdownMenu.Label className="px-3 py-1 text-xs uppercase tracking-wider text-muted">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            {THEMES.map((t) => (
              <DropdownMenu.RadioItem key={t.value} value={t.value} className={row}>
                <span>{t.label}</span>
                <DropdownMenu.ItemIndicator className="ml-auto text-muted">{"✓"}</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
