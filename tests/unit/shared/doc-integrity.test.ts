import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { stampDocId, stampedDocId, isContaminated } from "~/shared/doc-integrity";

describe("doc-integrity contamination guard", () => {
  it("round-trips the document id stamp", () => {
    const doc = new Y.Doc();
    stampDocId(doc, "docA");
    expect(stampedDocId(doc)).toBe("docA");
  });

  it("treats a legacy (unstamped) doc as clean", () => {
    const doc = new Y.Doc();
    expect(stampedDocId(doc)).toBeNull();
    expect(isContaminated(doc, "docA")).toBe(false);
  });

  it("is clean when the stamp matches the expected id", () => {
    const doc = new Y.Doc();
    stampDocId(doc, "docA");
    expect(isContaminated(doc, "docA")).toBe(false);
  });

  it("flags a doc stamped with another document's id", () => {
    const doc = new Y.Doc();
    stampDocId(doc, "docB");
    expect(isContaminated(doc, "docA")).toBe(true);
  });

  it("detects the cross-document merge that concatenated files", () => {
    // The bug: a client still holding document B's Y.Doc connects to A's relay,
    // so B's content (and stamp) merge into A's doc. Reproduce it directly.
    const server = new Y.Doc(); // A's relay-side doc
    stampDocId(server, "docA");
    server.getText("default").insert(0, "A content");

    const foreign = new Y.Doc(); // a stale client still holding B
    // Give the foreign doc a higher clientID before it writes anything, so its
    // stamp wins the Yjs last-writer-wins on merge, the case the relay tripwire
    // is designed to catch.
    Object.defineProperty(foreign, "clientID", { value: server.clientID + 1 });
    stampDocId(foreign, "docB");
    foreign.getText("default").insert(0, "B content");

    Y.applyUpdate(server, Y.encodeStateAsUpdate(foreign));

    // The body has been contaminated (this is the concatenation) ...
    expect(server.getText("default").toString()).toContain("B content");
    // ... and the guard catches it, so the relay refuses to persist/broadcast.
    expect(isContaminated(server, "docA")).toBe(true);
  });
});
