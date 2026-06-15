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

  return { doc, awareness, socket, synced, user, setUserName, needsName, dismissNamePrompt, mode, setMode, docState, isOnboarding };
}
