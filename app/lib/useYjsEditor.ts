import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { useUserIdentity } from "./useUserIdentity";
import type { DocMode } from "~/shared/types";

export function useYjsEditor(docId: string, docKey: string | null = null) {
  // Tie the doc's identity to the document id (and recreate it if the id ever
  // changes). DocumentRoot is keyed on the id so this hook already remounts per
  // document, but keying the doc to docId as well makes "this Y.Doc belongs to
  // this document" structural rather than incidental: a stale doc can never be
  // reused for another file (the cause of the cross-doc concatenation bug).
  const doc = useMemo(() => new Y.Doc({ guid: docId }), [docId]);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const { user, setName: setUserName, needsName, dismissNamePrompt } = useUserIdentity();
  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const providerRef = useRef<YjsProvider | null>(null);
  const [synced, setSynced] = useState(false);
  // Idle pause: an open WebSocket keeps the document's Durable Object active
  // (and billing). After a spell of no local activity, or when the tab is
  // hidden, drop the connection so the DO goes cold; reconnect on return.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Edit is the default for an edit-link user; suggest-link users are forced to
  // suggest in DocumentContext regardless. Either can switch deliberately.
  const [mode, setModeState] = useState<DocMode>("edit");
  const [isOnboarding, setIsOnboarding] = useState(false);

  const socket = useAgent({
    agent: "document-agent",
    name: docId,
    query: docKey ? { k: docKey } : undefined,
  });

  // Observe docState Y.Map for mode and onboarding changes from other clients
  useEffect(() => {
    const observer = () => {
      const m = docState.get("mode");
      if (m === "edit" || m === "suggest") {
        setModeState(m);
      }
      setIsOnboarding(docState.get("onboarding") === "true");
    };
    docState.observe(observer);
    // Read initial value
    observer();
    return () => {
      docState.unobserve(observer);
    };
  }, [docState]);

  const setMode = useCallback(
    (newMode: DocMode) => {
      docState.set("mode", newMode);
    },
    [docState],
  );

  // Publish identity to awareness so cursors relabel live when the name changes
  useEffect(() => {
    awareness.setLocalStateField("user", user);
  }, [awareness, user]);

  // Bridge socket to Yjs
  useEffect(() => {
    if (!socket) return;

    const ws = socket as unknown as WebSocket;
    const provider = new YjsProvider(ws, doc, awareness, setSynced);
    providerRef.current = provider;

    return () => {
      provider.destroy();
      providerRef.current = null;
      setSynced(false);
    };
  }, [socket, doc, awareness]);

  // Idle pause / resume. Real local interaction (keys, pointer, wheel, focus)
  // keeps the session alive; otherwise it drops the WebSocket after IDLE_MS, or
  // sooner once the tab is hidden, and reconnects on the next interaction or
  // when the tab is shown again.
  const resume = useCallback(() => {
    const ps = socket as unknown as { reconnect?: () => void } | null;
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      ps?.reconnect?.();
    }
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const ps = socket as unknown as { close?: () => void; reconnect?: () => void };
    const IDLE_MS = 5 * 60 * 1000;
    const HIDDEN_MS = 45 * 1000;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let hidden: ReturnType<typeof setTimeout> | undefined;

    const pause = () => {
      if (pausedRef.current) return;
      pausedRef.current = true;
      setPaused(true);
      ps.close?.();
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(pause, IDLE_MS);
    };
    const onActivity = () => {
      if (pausedRef.current) {
        pausedRef.current = false;
        setPaused(false);
        ps.reconnect?.();
      }
      armIdle();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(hidden);
        hidden = setTimeout(pause, HIDDEN_MS);
      } else {
        clearTimeout(hidden);
        onActivity();
      }
    };

    const events: (keyof WindowEventMap)[] = ["keydown", "pointerdown", "wheel", "focus"];
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    armIdle();

    return () => {
      clearTimeout(idle);
      clearTimeout(hidden);
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [socket]);

  return { doc, awareness, socket, synced, paused, resume, user, setUserName, needsName, dismissNamePrompt, mode, setMode, docState, isOnboarding };
}
