/**
 * gmist headless client: join a document's LIVE collaborative session as a Yjs
 * peer, print the body, and optionally post a CriticMarkup note. This is the
 * "Claude as a participant" path: it speaks the same Yjs sync protocol over the
 * agent WebSocket as the browser does (see app/lib/yjs-provider.ts), so its
 * edits merge live with the human editors, rather than overwriting the Drive
 * file out of band (which only reconciles at a sync boundary and can fork).
 *
 * Usage:
 *   node scripts/gmist-bot.mjs "<doc URL>" [--suggest "a note"] [--edits <file.json>]
 *
 * - <doc URL> is the share link, e.g.
 *   https://mist.broad-smoke-cc64.workers.dev/docs/<id>?k=<key>
 * - The `mist_session` cookie (a credential, never committed) comes from
 *   $GMIST_SESSION, or failing that scripts/.gmist-session (gitignored). Take it
 *   from a browser signed into gmist with a Google account the file is shared
 *   with (DevTools > Application > Cookies). The WebSocket gate (workers/app.ts)
 *   requires it plus the file's Drive ACL. It expires, so refresh when a run 401s.
 * - With no edit flag the client is read-only (connect, sync, print, observe and
 *   reprint on every remote change).
 * - --suggest "<text>" appends a CriticMarkup comment {>>text<<} to the body.
 * - --edits <file.json> applies a list of ANCHORED CriticMarkup edits, each found
 *   by a literal `find` substring of the current body:
 *     [{ "op": "comment",     "find": "intro", "text": "tighten this" },
 *      { "op": "replace",     "find": "teh",    "replace": "the" },
 *      { "op": "insertAfter", "find": ".",      "text": " More." },
 *      { "op": "delete",      "find": "very " }]
 *   replace/delete render as {--old--}{++new++} / {--old--} (additions and
 *   deletions, which gmist styles); a comment with no `find` is appended.
 *   This is the real tracked-changes review path; --suggest is the quick note.
 */

import { readFileSync } from "node:fs";
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
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    url: args.find((a) => /^https?:\/\//.test(a)),
    suggest: flag("--suggest"),
    editsPath: flag("--edits"),
  };
}

/** The cookie from $GMIST_SESSION, else the gitignored scripts/.gmist-session. */
function resolveSession() {
  if (process.env.GMIST_SESSION) return process.env.GMIST_SESSION.trim();
  try {
    return readFileSync(new URL("./.gmist-session", import.meta.url), "utf8").trim() || null;
  } catch {
    return null;
  }
}

const { url: docUrl, suggest, editsPath } = parseArgs(process.argv);
const session = resolveSession();
if (!docUrl || !session) {
  console.error('Usage: node scripts/gmist-bot.mjs <docUrl> [--suggest "text"] [--edits file.json]');
  console.error("(needs $GMIST_SESSION or scripts/.gmist-session)");
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

/** Apply one anchored edit, located by a literal `find` substring of the current
 *  body. Each is its own transaction so it becomes one CRDT update. */
function applyOp(op) {
  if (op.op === "comment" && !op.find) {
    body.insert(body.length, `\n\n{>>${op.text}<<}`);
    return "comment appended";
  }
  const text = body.toString();
  const idx = op.find ? text.indexOf(op.find) : -1;
  if (op.find && idx < 0) return `SKIP (anchor not found): ${JSON.stringify(op.find)}`;
  const end = idx + (op.find?.length ?? 0);
  switch (op.op) {
    case "comment":
      body.insert(end, `{>>${op.text}<<}`);
      return `comment at ${JSON.stringify(op.find)}`;
    case "insertAfter":
      body.insert(end, `{++${op.text}++}`);
      return `insert after ${JSON.stringify(op.find)}`;
    case "delete":
      body.delete(idx, op.find.length);
      body.insert(idx, `{--${op.find}--}`);
      return `delete ${JSON.stringify(op.find)}`;
    case "replace":
      body.delete(idx, op.find.length);
      body.insert(idx, `{--${op.find}--}{++${op.replace}++}`);
      return `replace ${JSON.stringify(op.find)} -> ${JSON.stringify(op.replace)}`;
    default:
      return `unknown op ${JSON.stringify(op.op)}`;
  }
}

function onSynced() {
  console.error("synced");
  printBody("initial");
  body.observe(() => printBody("updated"));

  if (editsPath) {
    const ops = JSON.parse(readFileSync(editsPath, "utf8"));
    for (const op of ops) console.error("  " + applyOp(op));
    console.error(`applied ${ops.length} edit(s); flushing then leaving...`);
    setTimeout(() => ws.close(), 1500);
    return;
  }
  if (suggest != null) {
    body.insert(body.length, `\n\n{>>Claude (bot): ${suggest}<<}`);
    console.error("posted a comment; flushing then leaving...");
    setTimeout(() => ws.close(), 1500);
    return;
  }
  console.error("read-only; observing live changes. Ctrl+C to exit.");
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
