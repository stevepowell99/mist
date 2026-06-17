import { useState, useEffect, useRef } from "react";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import SuggestionActions from "~/components/SuggestionActions";
import OnboardingBanner from "~/components/OnboardingBanner";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Narrow-screen bottom panel. The edit / suggest / preview control now lives in
 * the main header at every width, so this is no longer a second copy of it: it is
 * just the comments and suggestion surface that the hidden desktop sidebar would
 * otherwise provide. One tap opens it; activating a thread (e.g. tapping a
 * comment in the editor) opens it too.
 */
export default function MobilePanel({ className }: { className?: string }) {
  const { activeThreadId, threads } = useDocument();
  const [open, setOpen] = useState(false);
  const prevThreadIdRef = useRef(activeThreadId);

  // Open when a thread is activated (e.g. tapping a comment in the editor).
  useEffect(() => {
    if (activeThreadId && activeThreadId !== prevThreadIdRef.current) {
      setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect
    }
    prevThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-paper ${className ?? ""}`}
      style={open ? { height: "50vh" } : undefined}
    >
      <div className={`flex gap-2 px-3 pt-3 ${open ? "pb-2" : "pb-8"}`}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`cursor-pointer rounded-full px-4 py-1.5 text-sm uppercase tracking-wider transition-colors ${
            open ? "bg-ink text-paper" : "text-muted"
          }`}
        >
          {open ? "Close" : `Comments${threads.length > 0 ? ` (${threads.length})` : ""}`}
        </button>
      </div>
      {open && (
        <div className="overflow-y-auto pb-2" style={{ height: "calc(50vh - 48px)" }}>
          <OnboardingBanner />
          <SuggestionActions />
          <CommentInput />
          <ThreadList />
        </div>
      )}
    </div>
  );
}
