import { useState, useEffect, useRef } from "react";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import SuggestionActions from "~/components/SuggestionActions";
import ViewToggle from "~/components/ViewToggle";
import OnboardingBanner from "~/components/OnboardingBanner";
import { useDocument } from "~/lib/DocumentContext";

type Tab = "editing" | "comments";

const tabs: { id: Tab; label: string }[] = [
  { id: "editing", label: "View" },
  { id: "comments", label: "Comments" },
];

export default function MobilePanel({ className }: { className?: string }) {
  const { activeThreadId } = useDocument();
  const [activeTab, setActiveTab] = useState<Tab | null>("editing");
  const prevThreadIdRef = useRef(activeThreadId);

  // Switch to comments tab when a thread is activated (e.g. clicking in editor)
  useEffect(() => {
    if (activeThreadId && activeThreadId !== prevThreadIdRef.current) {
      setActiveTab("comments"); // eslint-disable-line react-hooks/set-state-in-effect
    }
    prevThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const collapsed = activeTab === null;
  // Only the comments tab (a scrolling thread list) needs the fixed-tall panel.
  // The view tab is short, so it sizes to its content and leaves no empty band.
  const tall = activeTab === "comments";

  const handleTabPress = (id: Tab) => {
    setActiveTab(activeTab === id ? null : id);
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-paper ${className ?? ""}`}
      style={tall ? { height: "33vh" } : undefined}
    >
      <div className={`flex gap-2 px-3 pt-3 ${collapsed ? "pb-8" : "pb-2"}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabPress(tab.id)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm uppercase tracking-wider transition-colors ${
              activeTab === tab.id ? "bg-ink text-paper" : "text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!collapsed && (
        <div
          className="overflow-y-auto pb-2"
          style={tall ? { height: "calc(33vh - 48px)" } : { maxHeight: "50vh" }}
        >
          {activeTab === "editing" && (
            <>
              <OnboardingBanner />
              <ViewToggle />
              <SuggestionActions />
            </>
          )}
          {activeTab === "comments" && (
            <>
              <CommentInput />
              <ThreadList />
            </>
          )}
        </div>
      )}
    </div>
  );
}
