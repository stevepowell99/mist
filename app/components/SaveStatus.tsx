import { useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Header indicator for GitHub-backed documents. Shows an amber "Unsaved" while
 * edits have not yet been committed to the repo, and "Saved" once the agent
 * confirms. Clicking commits immediately. Also warns before closing the tab
 * with uncommitted edits.
 */
export default function SaveStatus() {
  const { github, unsaved, commitToGitHub } = useDocument();

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  if (!github) return null;

  return (
    <button
      onClick={commitToGitHub}
      className={`flex h-full items-center gap-2 px-3 text-sm uppercase tracking-wider transition-colors ${
        unsaved ? "bg-coral text-paper hover:opacity-90" : "text-muted hover:bg-border"
      }`}
      title={
        unsaved
          ? "Unsaved changes. Click to save to GitHub now."
          : "All changes saved to GitHub"
      }
      aria-label={unsaved ? "Unsaved changes, save to GitHub now" : "Saved to GitHub"}
    >
      {unsaved ? (
        <>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-paper" />
          Unsaved
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Saved
        </>
      )}
    </button>
  );
}
