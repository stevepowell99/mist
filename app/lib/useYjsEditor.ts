import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { USER_COLOURS } from "~/shared/constants";
import type { UserInfo, DocMode } from "~/shared/types";

function randomUserInfo(): UserInfo {
  const idx = Math.floor(Math.random() * USER_COLOURS.length);
  const c = USER_COLOURS[idx];
  return {
    name: `User ${Math.floor(Math.random() * 1000)}`,
    color: c.color,
    colorLight: c.light,
  };
}

export function useYjsEditor(docId: string, docKey: string | null = null) {
  const doc = useMemo(() => new Y.Doc(), []);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const user = useMemo(() => randomUserInfo(), []);
  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const providerRef = useRef<YjsProvider | null>(null);
  const [synced, setSynced] = useState(false);
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

  return { doc, awareness, socket, synced, user, mode, setMode, docState, isOnboarding };
}
