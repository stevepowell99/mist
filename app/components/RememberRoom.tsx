import { useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { addRecentRoom } from "~/lib/room-recent";
import { firstHeading } from "~/lib/slides-build";

/**
 * Add an unbound room to this browser's recent-rooms list once it has synced,
 * and keep its title current as the first heading changes. Drive-bound docs
 * are listed by Drive itself, so they are skipped.
 */
export default function RememberRoom() {
  const { docId: id, drive, docKey, yjs } = useDocument();
  const { synced, doc } = yjs;

  useEffect(() => {
    if (drive || !docKey || !synced) return;
    const text = doc.getText("body");
    let timer = 0;
    const record = () => addRecentRoom({ id, key: docKey, title: firstHeading(text.toString()), openedAt: Date.now() });
    record();
    const onChange = () => {
      clearTimeout(timer);
      timer = window.setTimeout(record, 2000);
    };
    text.observe(onChange);
    return () => {
      clearTimeout(timer);
      text.unobserve(onChange);
    };
  }, [id, drive, docKey, synced, doc]);

  return null;
}
