import type * as Y from "yjs";

/**
 * Cross-document contamination guard.
 *
 * Every document's Y.Doc is stamped at seed with the id of the document it
 * belongs to (meta.docId === the Durable Object's name). If a client ever
 * merges a different document's content in (the cross-doc Yjs merge bug that
 * concatenated files), the stamp no longer matches, which the relay uses to
 * refuse persisting or broadcasting the contaminated state.
 *
 * The stamp lives inside the Yjs doc, so it is itself a CRDT value: on a merge
 * its final value is resolved by Yjs last-writer-wins and can occasionally stay
 * as ours. So this is a reliable tripwire, not a total guarantee. The actual
 * guarantee is on the client, where a Y.Doc is bound to its document id and is
 * never reused for another file.
 */
const DOC_ID_KEY = "docId";

export function stampDocId(doc: Y.Doc, id: string): void {
  doc.getMap("meta").set(DOC_ID_KEY, id);
}

/** The document id a doc was stamped with at seed, or null for legacy docs. */
export function stampedDocId(doc: Y.Doc): string | null {
  const v = doc.getMap("meta").get(DOC_ID_KEY);
  return typeof v === "string" ? v : null;
}

/**
 * True when a doc carries a different document's stamp, the signal that a
 * cross-document merge contaminated it. Legacy docs that predate the stamp have
 * no docId and are treated as clean.
 */
export function isContaminated(doc: Y.Doc, expectedId: string): boolean {
  const id = stampedDocId(doc);
  return id !== null && id !== expectedId;
}
