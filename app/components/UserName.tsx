import { useState, useRef, useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";

export default function UserName() {
  const { yjs } = useDocument();
  const { user, setUserName } = yjs;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(user.name);
    setEditing(true);
  }

  function commit() {
    setUserName(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-full w-32 bg-transparent px-3 text-sm outline-none"
        aria-label="Your name"
        maxLength={40}
        placeholder="Your name"
      />
    );
  }

  return (
    <button
      onClick={start}
      className="flex h-full items-center gap-2 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
      aria-label="Set your name"
      title="Set your name"
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: user.color }}
      />
      <span className="whitespace-nowrap">{user.name}</span>
    </button>
  );
}
