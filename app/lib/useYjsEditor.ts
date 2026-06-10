import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { useUserIdentity } from "./useUserIdentity";
import type { DocMode } from "~/shared/types";

export function useYjsEditor(docId: string, docKey: string | null = null) {
  const doc = useMemo(() => new Y.Doc(), []);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const { user, setName: setUserName } = useUserIdentity();
  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const providerRef = useRef<YjsProvider | null>(null);
  const [synced, setSynced] = useState(false);
  // Suggest is the default; edit-link users can switch to Edit deliberately
  const [mode, setModeState] = useState<DocMode>("suggest");
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

  return { doc, awareness, socket, synced, user, setUserName, mode, setMode, docState, isOnboarding };
}
