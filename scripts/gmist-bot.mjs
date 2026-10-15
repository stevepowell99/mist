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
 *   node scripts/gmist-bot.mjs "<doc URL>" --get <file.md>
 *   node scripts/gmist-bot.mjs "<doc URL>" --put <file.md>
 *
 * - <doc URL> is the share link, e.g.
 *   https://mist.broad-smoke-cc64.workers.dev/docs/<id>?k=<key>
 * - A shared room (no Drive file) needs only the link. A Drive document also
 *   needs the `mist_session` cookie (a credential, never committed), from
 *   $GMIST_SESSION or else scripts/.gmist-session (gitignored). Take it from a
 *   browser signed into gmist with a Google account the file is shared with
 *   (DevTools > Application > Cookies). The WebSocket gate (workers/app.ts)
 *   requires it plus the file's Drive ACL. It expires, so refresh when a run 401s.
 * - --get <file.md> saves the body to <file.md> and a copy to <file.md>.base,
 *   then leaves. --put <file.md> makes the body equal to <file.md> as a direct
 *   (untracked) edit, applied as a minimal diff so live editors keep their
 *   cursors. It refuses, writing the newer body to <file.md>.theirs, if the body
 *   no longer matches <file.md>.base, so a write never undoes someone's edit made
 *   since the read; after writing it reads the body back over HTTP to confirm.
 * - --watch <state.json> stays connected and prints one MENTION line to stdout
 *   for each new comment or reply containing @claude (not the bot's own), for a
 *   Monitor to wake on; reported keys persist in <state.json>.
 * - --edits also takes { "op": "reply", "find": <part of a thread's comment>,
 *   "text": ... }, which appends a reply as the editor's Reply box does.
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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
    getPath: flag("--get"),
    putPath: flag("--put"),
    watchPath: flag("--watch"),
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

const { url: docUrl, suggest, editsPath, getPath, putPath, watchPath } = parseArgs(process.argv);
const session = resolveSession();
if (!docUrl) {
  console.error('Usage: node scripts/gmist-bot.mjs <docUrl> [--suggest "text"] [--edits file.json] [--get file.md] [--put file.md]');
  console.error("(a Drive document also needs $GMIST_SESSION or scripts/.gmist-session)");
  process.exit(1);
}
const cookieHeaders = session ? { Cookie: `mist_session=${session}` } : {};
const lf = (s) => s.replace(/\r\n?/g, "\n");
if (putPath && !existsSync(`${putPath}.base`)) {
  console.error(`error: no ${putPath}.base; run --get first so the write can be checked against it`);
  process.exit(1);
}

const u = new URL(docUrl);
const docId = u.pathname.split("/").filter(Boolean).pop(); // .../docs/<id>
const key = u.searchParams.get("k") ?? "";
const wsScheme = u.protocol === "http:" ? "ws" : "wss"; // plain ws for a localhost doc URL
const wsUrl = `${wsScheme}://${u.host}/agents/document-agent/${encodeURIComponent(docId)}?k=${encodeURIComponent(key)}`;

const doc = new Y.Doc();
const body = doc.getText("body"); // the raw-markdown CRDT the editor binds to
const awareness = new awarenessProtocol.Awareness(doc);
const BOT_USER = { name: "Claude", color: "#00A86B", colorLight: "#00A86B" };
awareness.setLocalStateField("user", { name: "Claude (bot)", color: "#00FFAF" });

const ws = new WebSocket(wsUrl, { headers: cookieHeaders });
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

const threadsMap = doc.getMap("threads");

function readThreads() {
  const out = [];
  threadsMap.forEach((v) => {
    try { out.push(JSON.parse(v)); } catch { /* skip a malformed entry */ }
  });
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Create the thread entry for a comment the bot just wrote. Editors match
 *  threads to `{>>note<<}` by the note's text and create any that are missing
 *  under their OWN user, so without this a bot comment shows as written by
 *  whoever opened the doc next. */
function claimThread(note) {
  const id = Math.random().toString(36).slice(2, 10);
  threadsMap.set(id, JSON.stringify({ id, commentText: note, author: BOT_USER, createdAt: Date.now(), resolved: false, replies: [] }));
}

/** Every comment or reply that mentions @claude and was not written by the bot,
 *  each with a stable key so a watcher reports it once. */
function mentions() {
  const out = [];
  for (const t of readThreads()) {
    if (/@claude\b/i.test(t.commentText) && t.author?.name !== BOT_USER.name)
      out.push({ key: `${t.id}:c`, thread: t.id, text: t.commentText, on: t.highlightText ?? "" });
    for (const r of t.replies ?? [])
      if (/@claude\b/i.test(r.text) && r.author?.name !== BOT_USER.name)
        out.push({ key: `${t.id}:${r.id}`, thread: t.id, text: r.text, on: t.commentText.slice(0, 80) });
  }
  return out;
}

/** Apply one anchored edit, located by a literal `find` substring of the current
 *  body. Each is its own transaction so it becomes one CRDT update. A `reply`
 *  finds its thread by a substring of the thread's comment and appends to its
 *  replies, as the editor's Reply box does. */
function applyOp(op) {
  if (op.op === "reply") {
    const t = readThreads().find((x) => x.commentText.includes(op.find));
    if (!t) return `SKIP (no thread whose comment contains): ${JSON.stringify(op.find)}`;
    t.replies.push({ id: Math.random().toString(36).slice(2, 10), author: BOT_USER, text: op.text, createdAt: Date.now() });
    threadsMap.set(t.id, JSON.stringify(t));
    return `reply on ${JSON.stringify(t.commentText.slice(0, 40))}`;
  }
  if (op.op === "comment" && !op.find) {
    body.insert(body.length, `\n\n{>>${op.text}<<}`);
    claimThread(op.text);
    return "comment appended";
  }
  const text = body.toString();
  const idx = op.find ? text.indexOf(op.find) : -1;
  if (op.find && idx < 0) return `SKIP (anchor not found): ${JSON.stringify(op.find)}`;
  const end = idx + (op.find?.length ?? 0);
  switch (op.op) {
    case "comment":
      body.insert(end, `{>>${op.text}<<}`);
      claimThread(op.text);
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

/** Make the body equal `text` by one minimal diff (common prefix and suffix
 *  kept), the same way the agent applies a Drive pull. */
function replaceBody(text) {
  const old = body.toString();
  if (old === text) return;
  let p = 0;
  const max = Math.min(old.length, text.length);
  while (p < max && old[p] === text[p]) p++;
  let s = 0;
  while (s < max - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
  doc.transact(() => {
    if (old.length - p - s > 0) body.delete(p, old.length - p - s);
    const insert = text.slice(p, text.length - s);
    if (insert) body.insert(p, insert);
  });
}

/** The body as the server holds it, read over HTTP: proof a write landed. */
async function serverBody() {
  const res = await fetch(`${u.protocol}//${u.host}/agents/document-agent/${encodeURIComponent(docId)}?source&k=${encodeURIComponent(key)}`, {
    headers: { ...cookieHeaders, "User-Agent": "gmist-bot/1" },
  });
  if (!res.ok) throw new Error(`read-back failed (${res.status})`);
  return (await res.json()).markdown;
}

function onSynced() {
  console.error("synced");

  if (getPath) {
    const text = body.toString();
    writeFileSync(getPath, text);
    writeFileSync(`${getPath}.base`, text);
    // The comment threads (author, replies, resolved) live beside the text in the
    // Yjs `threads` map, keyed by thread id; the markup holds only the note.
    writeFileSync(`${getPath}.threads.json`, JSON.stringify(readThreads(), null, 2));
    console.error(`got ${text.length} chars into ${getPath}, threads into ${getPath}.threads.json`);
    ws.close();
    return;
  }
  if (putPath) {
    const current = body.toString();
    if (lf(readFileSync(`${putPath}.base`, "utf8")) !== current) {
      writeFileSync(`${putPath}.theirs`, current);
      console.error(`refused: the document changed since the read. Its text is in ${putPath}.theirs; merge into ${putPath}, copy .theirs over .base, then put again.`);
      process.exitCode = 1;
      ws.close();
      return;
    }
    const text = lf(readFileSync(putPath, "utf8"));
    replaceBody(text);
    setTimeout(async () => {
      try {
        if ((await serverBody()) !== text) throw new Error("the server does not hold what was sent; --get again and compare");
        writeFileSync(`${putPath}.base`, text);
        console.error(`put ${text.length} chars; read back and matched`);
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exitCode = 1;
      }
      ws.close();
    }, 1500);
    return;
  }

  if (watchPath) {
    // One line per new @claude mention, on stdout, for a Monitor to wake on.
    // Keys already reported are kept in the state file, so a restart is quiet.
    let seen = new Set();
    try { seen = new Set(JSON.parse(readFileSync(watchPath, "utf8"))); } catch { /* first run */ }
    let timer = null;
    const check = () => {
      for (const m of mentions()) {
        if (seen.has(m.key)) continue;
        seen.add(m.key);
        console.log(`MENTION thread=${m.thread} on=${JSON.stringify(m.on)} text=${JSON.stringify(m.text)}`);
      }
      writeFileSync(watchPath, JSON.stringify([...seen]));
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(check, 3000); };
    threadsMap.observe(soon);
    body.observe(soon);
    check();
    console.error(`watching for @claude; state in ${watchPath}`);
    return;
  }

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

ws.on("close", () => { console.error("closed"); process.exit(process.exitCode ?? 0); });
ws.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
