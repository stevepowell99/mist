import { data, Link } from "react-router";
import { useRef, useCallback, useEffect, useLayoutEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocRole, DriveMeta, GitHubMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import ViewToggle from "~/components/ViewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import UserName from "~/components/UserName";
import SaveStatus from "~/components/SaveStatus";
import ShareButton from "~/components/ShareButton";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import NamePrompt from "~/components/NamePrompt";
import FolderSidebar from "~/components/FolderSidebar";
import SlidesView, { isSlideDeck } from "~/components/SlidesView";

// useLayoutEffect on the client (so scroll is restored before paint, no flash),
// useEffect on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function fileTitle(github: GitHubMeta | null, drive: DriveMeta | null, fallback: string): string {
  const raw = github ? github.path.split("/").pop() : drive?.name;
  if (!raw) return fallback;
  const name = raw.replace(/\.(md|qmd)$/i, "");
  return name || fallback;
}

export function meta({ data }: Route.MetaArgs) {
  const title = data?.github || data?.drive ? fileTitle(data.github, data.drive, "mist") : "mist";
  return [{ title: title || "mist" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const docKey = searchParams.get("k");
  const initialPreview = searchParams.get("view") === "preview";
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(
    new Request(`https://do/?k=${encodeURIComponent(docKey ?? "")}`),
  );
  const { exists, createdAt, role, suggestKey, github, drive } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    role: DocRole | null;
    suggestKey?: string;
    github: GitHubMeta | null;
    drive: DriveMeta | null;
  };

  if (!exists || !role) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt, role, suggestKey: suggestKey ?? null, docKey, github, drive, initialPreview };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt, role, suggestKey, docKey, github, drive, initialPreview } = loaderData;
  const yjs = useYjsEditor(id, docKey);

  return (
    <DocumentProvider
      docId={id}
      createdAt={createdAt}
      yjs={yjs}
      role={role}
      docKey={docKey}
      suggestKey={suggestKey}
      github={github}
      drive={drive}
      initialPreview={initialPreview}
    >
      <DocumentLayout id={id} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id }: { id: string }) {
  const {
    yjs,
    editorInstance,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    cleanView,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    mode,
    toggleMode,
    role,
    github,
    drive,
    bibLib,
    markdown,
    frontmatter,
    togglePreview,
    threads,
  } = useDocument();

  const title = fileTitle(github, drive, id);
  const deck = isSlideDeck(markdown, github, frontmatter, drive);
  const slidesMode = showPreview && deck;

  // Desktop-only draggable split: drag the gutter left to put the editor on the
  // left and a live preview on the right. editorPct is the editor's width; at
  // 100 there is no split. Mobile keeps the full-swap Preview toggle.
  const [isDesktop, setIsDesktop] = useState(false);
  const [editorPct, setEditorPct] = useState(100);
  const contentRef = useRef<HTMLDivElement>(null);
  const splitOpen = isDesktop && editorPct <= 95;

  // Collapsible right panel: a thin strip when collapsed, peeking on hover as an
  // overlay so the editor does not reflow. Persisted per browser.
  const [asideCollapsed, setAsideCollapsed] = useState(false);
  const [asidePeek, setAsidePeek] = useState(false);
  useEffect(() => {
    setAsideCollapsed(localStorage.getItem("mistAsideCollapsed") === "1"); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  const setAsideCollapsedPersist = useCallback((v: boolean) => {
    setAsideCollapsed(v);
    setAsidePeek(false);
    localStorage.setItem("mistAsideCollapsed", v ? "1" : "0");
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Keyboard shortcuts (mod+alt+key): E edit, S suggest, V preview, \ split.
  // One handler keeps it DRY; mod+alt avoids clashing with typing and browser keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
      const actions: Record<string, () => void> = {
        e: () => role === "edit" && mode !== "edit" && toggleMode(),
        s: () => mode !== "suggest" && role === "edit" && toggleMode(),
        v: () => togglePreview(),
        "\\": () => isDesktop && setEditorPct((p) => (p > 95 ? 50 : 100)),
      };
      const action = actions[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [role, mode, toggleMode, togglePreview, isDesktop]);

  const startDrag = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setEditorPct(Math.min(100, Math.max(20, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // The editor and Preview share this scroll container, so swapping between
  // them would otherwise jump to the top. Track the scroll fraction and restore
  // it when the view flips, re-applying as Preview's content settles (it mounts
  // empty then fills in, which changes the scroll height).
  const mainRef = useRef<HTMLElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const scrollFraction = useRef(0);
  const restoring = useRef(false);

  const applyFraction = useCallback(() => {
    const m = mainRef.current;
    if (!m) return;
    const max = m.scrollHeight - m.clientHeight;
    m.scrollTop = max > 0 ? scrollFraction.current * max : 0;
  }, []);

  const handleScroll = useCallback(() => {
    if (restoring.current) return;
    const m = mainRef.current;
    if (!m) return;
    const max = m.scrollHeight - m.clientHeight;
    scrollFraction.current = max > 0 ? m.scrollTop / max : 0;
  }, []);

  useIsomorphicLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // Preview mounts empty then renders its markdown (and images) over several
    // frames, so a one-shot restore lands at the wrong height. Re-apply the
    // fraction each frame until the scroll height holds steady, then stop.
    restoring.current = true;
    let raf = 0;
    let lastHeight = -1;
    let stableFrames = 0;
    const start = performance.now();
    const tick = () => {
      applyFraction();
      const h = main.scrollHeight;
      if (h === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = h;
      }
      if (stableFrames < 4 && performance.now() - start < 700) {
        raf = requestAnimationFrame(tick);
      } else {
        restoring.current = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      restoring.current = false;
    };
  }, [showPreview, applyFraction]);

  // In the desktop split with the document preview, sync the two panes'
  // y-scroll. Pure proportional drifts on long docs because headings/images
  // expand differently, so anchor on headings (which exist in both) and
  // interpolate between them, falling back to proportional when they do not
  // line up. A flag breaks the feedback loop between the two listeners.
  useEffect(() => {
    if (!splitOpen || slidesMode) return;
    const ed = mainRef.current;
    const pv = previewScrollRef.current;
    const edRoot = editorInstance?.view.dom as HTMLElement | undefined;
    if (!ed || !pv || !edRoot) return;

    const offsetIn = (el: Element, container: HTMLElement) =>
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

    // Anchor pairs (editorTop, previewTop), bracketed by the scroll extremes.
    const anchors = (): { from: number; to: number }[] | null => {
      const edHeads = Array.from(edRoot.children).filter((c) =>
        /^#{1,6}\s/.test((c.textContent ?? "").trimStart()),
      );
      const pvHeads = Array.from(pv.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      if (edHeads.length < 1 || edHeads.length !== pvHeads.length) return null;
      const pairs = edHeads.map((e, i) => ({ from: offsetIn(e, ed), to: offsetIn(pvHeads[i], pv) }));
      return [{ from: 0, to: 0 }, ...pairs];
    };

    const interp = (top: number, pairs: { from: number; to: number }[], toMax: number) => {
      for (let i = pairs.length - 1; i >= 0; i--) {
        if (top >= pairs[i].from) {
          const next = pairs[i + 1];
          if (!next) return Math.min(pairs[i].to + (top - pairs[i].from), toMax);
          const span = next.from - pairs[i].from || 1;
          const frac = (top - pairs[i].from) / span;
          return pairs[i].to + frac * (next.to - pairs[i].to);
        }
      }
      return top;
    };

    const sync = (from: HTMLElement, to: HTMLElement, dir: "fromEd" | "fromPv") => {
      if (syncingScroll.current) return;
      syncingScroll.current = true;
      const toMax = to.scrollHeight - to.clientHeight;
      const pairs = anchors();
      let target: number;
      if (pairs) {
        const mapped = dir === "fromEd" ? pairs : pairs.map((p) => ({ from: p.to, to: p.from }));
        target = interp(from.scrollTop, mapped, toMax);
      } else {
        const fromMax = from.scrollHeight - from.clientHeight;
        target = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
      }
      to.scrollTop = Math.max(0, Math.min(target, toMax));
      requestAnimationFrame(() => {
        syncingScroll.current = false;
      });
    };
    const onEd = () => sync(ed, pv, "fromEd");
    const onPv = () => sync(pv, ed, "fromPv");
    ed.addEventListener("scroll", onEd);
    pv.addEventListener("scroll", onPv);
    return () => {
      ed.removeEventListener("scroll", onEd);
      pv.removeEventListener("scroll", onPv);
    };
  }, [splitOpen, slidesMode, editorInstance]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch border-b border-border">
        <Link
          to="/"
          className="flex shrink-0 items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          mist
        </Link>
        <FolderSidebar />
        <div className="flex min-w-0 grow items-center px-4">
          <span className="truncate font-medium" title={title}>{title}</span>
        </div>
        {/* On desktop the right group is the aside width so its left edge lines up with
            the body/sidebar divide. On mobile there is no sidebar, so it sizes naturally. */}
        <div className="flex shrink-0 items-stretch lg:w-96">
          <div className="flex items-center border-l border-border px-3 lg:min-w-0 lg:flex-1 lg:justify-center lg:overflow-hidden lg:px-2">
            <ConnectionStatus />
          </div>
          <div className="hidden shrink-0 items-center border-l border-border lg:flex">
            <UserName />
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <SaveStatus />
          </div>
          <div className="shrink-0 border-l border-border">
            <ShareButton />
          </div>
          <div className="flex shrink-0 items-center border-l border-border">
            <ThemeSelector />
          </div>
        </div>
      </header>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={contentRef} className="flex flex-1 overflow-hidden">
          <main
            ref={mainRef}
            onScroll={handleScroll}
            className={`lg:border-r lg:border-border ${
              splitOpen
                ? "shrink-0 overflow-y-auto"
                : `flex-1 ${slidesMode ? "overflow-hidden" : "overflow-y-auto pb-[33vh] lg:pb-0"}`
            }`}
            style={splitOpen ? { width: `${editorPct}%` } : undefined}
          >
            <Editor
              yjs={yjs}
              forceSuggest={role === "suggest"}
              github={github}
              bibLib={bibLib}
              hidden={splitOpen ? false : showPreview}
              onEditorReady={handleEditorReady}
              onCommentClick={handleCommentClick}
              commentHighlight={commentHighlight}
              activeCommentRange={activeCommentRange}
              cleanView={cleanView}
              onNewComment={openCommentInput}
              onResolveAtCursor={handleResolveAtCursor}
              onDeleteAtCursor={handleDeleteAtCursor}
            />
            {!splitOpen && showPreview && (slidesMode ? <SlidesView /> : <Preview />)}
          </main>
          {isDesktop && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              title="Drag to split editor and preview"
              className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-chartreuse"
            />
          )}
          {splitOpen && (
            <section className="flex-1 overflow-hidden">
              {deck ? <SlidesView /> : <div ref={previewScrollRef} className="h-full overflow-y-auto"><Preview /></div>}
            </section>
          )}
        </div>
        {/* Collapsed strip: essentials only (expand control + comment count). */}
        {asideCollapsed && !asidePeek && (
          <div
            onMouseEnter={() => setAsidePeek(true)}
            className="hidden w-9 shrink-0 flex-col items-center gap-3 border-l border-border py-2 lg:flex"
          >
            <button
              type="button"
              onClick={() => setAsideCollapsedPersist(false)}
              title="Expand panel"
              aria-label="Expand panel"
              className="cursor-pointer p-1 text-muted hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {threads.length > 0 && (
              <span className="rounded bg-coral/20 px-1 text-xs text-coral" title={`${threads.length} comments`}>
                {threads.length}
              </span>
            )}
          </div>
        )}
        {(!asideCollapsed || asidePeek) && (
          <aside
            onMouseLeave={() => asidePeek && setAsidePeek(false)}
            className={`hidden w-96 flex-col overflow-hidden border-l border-border bg-paper lg:flex ${
              asidePeek ? "absolute right-0 top-0 z-30 h-full shadow-lg" : ""
            }`}
          >
            <div className="flex shrink-0 items-stretch border-b border-border">
              <button
                type="button"
                onClick={() => setAsideCollapsedPersist(true)}
                title="Collapse panel"
                aria-label="Collapse panel"
                className="flex cursor-pointer items-center px-2 text-muted hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <ViewToggle />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <OnboardingBanner />
              <SuggestionActions />
              {mode === "suggest" && <CleanViewToggle />}
              <div className="border-t border-border" />
              <CommentInput />
              <ThreadList />
            </div>
          </aside>
        )}
      </div>
      <MobilePanel className="lg:hidden" />
      <NamePrompt />
    </div>
  );
}
