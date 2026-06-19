/**
 * gmist headless client: join a document's LIVE collaborative session as a Yjs
 * peer, print the body, and optionally post a CriticMarkup note. This is the
 * "Claude as a participant" path: it speaks the same Yjs sync protocol over the
 * agent WebSocket as the browser does (see app/lib/yjs-provider.ts), so its
 * edits merge live with the human editors, rather than overwriting the Drive
 * file out of band (which only reconciles at a sync boundary and can fork).
 *
 * Usage:
 *   GMIST_SESSION="<mist_session cookie value>" \
 *     node scripts/gmist-bot.mjs "<doc URL>" [--suggest "a note"]
 *
 * - <doc URL> is the share link, e.g.
 *   https://mist.broad-smoke-cc64.workers.dev/docs/<id>?k=<key>
 * - GMIST_SESSION is the value of the `mist_session` cookie taken from a browser
 *   signed into gmist with a Google account the file is shared with (DevTools >
 *   Application > Cookies). It is a credential: never commit it. The WebSocket
 *   gate (workers/app.ts) requires it plus the file's Drive ACL.
 * - Without --suggest the client is read-only (connect, sync, print, observe and
 *   reprint on every remote change). With --suggest "<text>" it appends a
 *   CriticMarkup comment {>>text<<} to the body, which surfaces as a review
 *   comment in every connected editor, then disconnects.
 */

import WebSocket from "ws";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

// Mirror app/shared/constants.ts (the worker tags every frame with these).
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

function parseArgs(argv) {
  const args = argv.slice(2);
  const i = args.indexOf("--suggest");
  return {
    url: args.find((a) => /^https?:\/\//.test(a)),
    suggest: i >= 0 ? args[i + 1] : null,
  };
}

const { url: docUrl, suggest } = parseArgs(process.argv);
const session = process.env.GMIST_SESSION;
if (!docUrl || !session) {
  console.error('Usage: GMIST_SESSION=<cookie> node scripts/gmist-bot.mjs <docUrl> [--suggest "text"]');
  process.exit(1);
}

const u = new URL(docUrl);
const docId = u.pathname.split("/").filter(Boolean).pop(); // .../docs/<id>
const key = u.searchParams.get("k") ?? "";
const wsUrl = `wss://${u.host}/agents/document-agent/${encodeURIComponent(docId)}?k=${encodeURIComponent(key)}`;

const doc = new Y.Doc();
const body = doc.getText("body"); // the raw-markdown CRDT the editor binds to
const awareness = new awarenessProtocol.Awareness(doc);
awareness.setLocalStateField("user", { name: "Claude (bot)", color: "#00FFAF" });

const ws = new WebSocket(wsUrl, { headers: { Cookie: `mist_session=${session}` } });
let synced = false;

function send(bytes) {
  if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
}

function sendSyncStep1() {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  send(encoding.toUint8Array(enc));
  // Announce presence so humans see "Claude (bot)" in the session.
  const aenc = encoding.createEncoder();
  encoding.writeVarUint(aenc, MSG_AWARENESS);
  encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]));
  send(encoding.toUint8Array(aenc));
}

function printBody(tag) {
  const text = body.toString();
  console.log(`\n----- body (${tag}, ${text.length} chars) -----`);
  console.log(text);
  console.log("----- end -----\n");
}

function onSynced() {
  console.error("synced");
  printBody("initial");
  body.observe(() => printBody("updated"));
  if (suggest == null) {
    console.error("read-only; observing live changes. Ctrl+C to exit.");
    return;
  }
  const note = `\n\n{>>Claude (bot): ${suggest}<<}`;
  body.insert(body.length, note); // a CriticMarkup comment, merges into the CRDT
  console.error(`posted a comment (${note.length} chars); flushing then leaving...`);
  setTimeout(() => ws.close(), 1500); // let the update reach the server
}

ws.on("open", () => {
  console.error(`connected to ${docId}`);
  sendSyncStep1();
});

ws.on("message", (data) => {
  const bytes = new Uint8Array(data); // ws delivers a Buffer; copy to a plain view
  const decoder = decoding.createDecoder(bytes);
  const type = decoding.readVarUint(decoder);
  if (type === MSG_SYNC) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    // 4th arg is the transaction origin: tag server-applied updates with `ws` so
    // our doc "update" handler below does not echo them back.
    const syncType = syncProtocol.readSyncMessage(decoder, enc, doc, ws);
    if (syncType === 1 && !synced) {
      // 1 = syncStep2: we now hold the full document.
      synced = true;
      onSynced();
    }
    if (encoding.length(enc) > 1) send(encoding.toUint8Array(enc));
  } else if (type === MSG_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
  }
});

// Relay our own local edits (the suggestion) to the server, exactly like the
// browser provider; skip updates that originated from the server.
doc.on("update", (update, origin) => {
  if (origin === ws) return;
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeUpdate(enc, update);
  send(encoding.toUint8Array(enc));
});

ws.on("close", () => { console.error("closed"); process.exit(0); });
ws.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
