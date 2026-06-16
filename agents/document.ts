import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOC_FORMAT_VERSION } from "../app/shared/constants";
import type { DocRole, DriveMeta } from "../app/shared/types";
import { type DocBackend, DriveBackend } from "../app/lib/backend.server";
import { type DriveEnv, driveConfigured } from "../app/lib/google.server";
import { quickHash } from "../app/shared/hash";
import { stampDocId, isContaminated } from "../app/shared/doc-integrity";

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

function textBlob(text: string): string {
  return sqlBlob(new TextEncoder().encode(text));
}

const KEY_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const KEY_LENGTH = 24;

// Origin tag for Y.Text mutations the relay itself makes (pulling a fresh
// version from Drive). The update handler broadcasts these to every client; a
// client-originated update is already relayed in onMessage, so only server ones
// need this path.
const SERVER_ORIGIN = "mist-server";

// Don't re-read Drive on every reconnect storm; one check per this window is
// enough to catch an external edit on reload.
const UPSTREAM_CHECK_MS = 10_000;

function generateSecretKey(): string {
  const bytes = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let key = "";
  for (const b of bytes) key += KEY_CHARS[b % KEY_CHARS.length];
  return key;
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  // Wall-clock of the last Drive upstream check, to throttle reconnect storms.
  private lastUpstreamCheck = 0;

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Create table if needed
    this.sql`
      CREATE TABLE IF NOT EXISTS doc_state (
        key TEXT PRIMARY KEY,
        value BLOB
      )
    `;

    // Load persisted state
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;

    if (rows.length > 0 && rows[0].value) {
      const state = new Uint8Array(rows[0].value);
      Y.applyUpdate(this.doc, state);
    }

    // Persist on every update, unless the doc has been contaminated by another
    // document's content (the cross-doc Yjs merge bug). Persisting corrupted
    // state is what concatenated files, so refuse it: the last clean snapshot
    // stays in storage and the DO reverts to it on its next load.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (this.isContaminated()) return;
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      // A relay-made change (Drive pull) has no client message to relay, so push
      // it to every connection as a sync update; client changes already relay in
      // onMessage.
      if (origin === SERVER_ORIGIN) this.broadcastUpdate(update);
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  /**
   * Structural integrity check. At seed the doc is stamped with its own id
   * (meta.docId === this DO's name). If a client ever merges a different
   * document's content in, that stamp no longer matches, which is the signal
   * that this doc has been contaminated and must not be persisted or broadcast.
   * Legacy docs predating the stamp have no docId and are treated as clean.
   */
  private isContaminated(): boolean {
    return this.doc ? isContaminated(this.doc, this.name) : false;
  }

  private readStoredText(key: string): string | null {
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = ${key}
    `;
    return rows.length > 0 ? new TextDecoder().decode(new Uint8Array(rows[0].value)) : null;
  }

  private ensureKeys(): { editKey: string; suggestKey: string } {
    let editKey = this.readStoredText("editKey");
    let suggestKey = this.readStoredText("suggestKey");
    if (!editKey || !suggestKey) {
      editKey = generateSecretKey();
      suggestKey = generateSecretKey();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('editKey', ${textBlob(editKey)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('suggestKey', ${textBlob(suggestKey)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
    }
    return { editKey, suggestKey };
  }

  private roleForKey(k: string | null): DocRole | null {
    if (!k) return null;
    const { editKey, suggestKey } = this.ensureKeys();
    if (k === editKey) return "edit";
    if (k === suggestKey) return "suggest";
    return null;
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const { doc, awareness } = this.ensureInitialised();

    const k = new URL(ctx.request.url).searchParams.get("k");
    if (!this.roleForKey(k)) {
      connection.close(4403, "Invalid or missing key");
      return;
    }

    // Catch an external edit (Obsidian/Drive) made while the room was idle, so
    // a reload shows fresh content. A fresh connect should always re-read Drive
    // (the throttle is only meant to damp reconnect storms, but it can also
    // suppress the pull right after a reload), so clear it first. The version
    // check inside still skips the pull when nothing actually changed. Never let
    // a Drive hiccup break the connect.
    try {
      this.lastUpstreamCheck = 0;
      await this.checkUpstream(false);
    } catch {
      // upstream check is best-effort; fall through to sync the current state
    }

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    connection.send(encoding.toUint8Array(syncEncoder));

    // Send SyncStep2 (full state) to the new client
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, doc);
    connection.send(encoding.toUint8Array(stateEncoder));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const clients = Array.from(awarenessStates.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      connection.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message === "string") {
      // JSON control messages. The connection already passed key validation in
      // onConnect, so any connected client may relay the serialized document
      // (it is the shared doc state everyone already sees).
      await this.handleControl(message);
      return;
    }

    const { doc, awareness } = this.ensureInitialised();

    const data =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        // A client carrying another document's content would merge it in here.
        // Detect it before broadcasting and drop the offending session, so the
        // contamination neither reaches other clients nor (via the persist
        // guard) reaches storage.
        if (this.isContaminated()) {
          connection.close(4400, "cross-document contamination rejected");
          break;
        }

        // If there's a response (e.g. SyncStep2 reply), send it back
        if (encoding.length(encoder) > 1) {
          connection.send(encoding.toUint8Array(encoder));
        }

        // Broadcast the raw message to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, connection);

        // Broadcast awareness to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
    }
  }

  async onClose(
    connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.awareness) {
      // Remove this client's awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        // Agents SDK uses string IDs; awareness protocol expects numbers.
      // The protocol converts via toString() internally, so this is safe.
      [connection.id as unknown as number],
        null,
      );
    }
  }

  /**
   * Handle JSON control messages. Currently a `doc` message carrying the
   * serialized markdown of a Drive-backed document, which is written back to
   * Drive on an explicit save (when `commitNow` is set).
   */
  private async handleControl(raw: string) {
    let msg: { type?: string; content?: string; commitNow?: boolean };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    // Explicit user reload: take the Drive version even if the body diverged.
    if (msg.type === "pull") {
      try {
        await this.checkUpstream(true);
      } catch {
        // best-effort; the client can retry
      }
      return;
    }
    if (msg.type !== "doc" || typeof msg.content !== "string") return;
    // only Drive-bound docs write back
    if (!this.readStoredText("drive")) return;
    // EXPLICIT SAVE ONLY (14 June 2026): never auto-commit. Only a user pressing
    // save (commitNow) writes back. The auto-commit-on-open/typing was what
    // corrupted vault files, so relayed content without commitNow is ignored.
    if (!msg.commitNow) return;

    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('pendingMd', ${textBlob(msg.content)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
    await this.commitPending();
  }

  override readonly alarm = async (): Promise<void> => {
    await this.commitPending();
  };

  /** The storage backend this doc is bound to (Drive), with a label for the
   *  commit message. Null if none is bound or Drive is unconfigured. */
  private backendFor(): { backend: DocBackend; label: string } | null {
    const driveRaw = this.readStoredText("drive");
    if (driveRaw) {
      const env = this.env as unknown as DriveEnv;
      if (!driveConfigured(env)) return null;
      const drive = JSON.parse(driveRaw) as DriveMeta;
      return { backend: new DriveBackend(drive, env), label: drive.name ?? drive.fileId };
    }
    return null;
  }

  /** Send a server-made Yjs update to every connection as a sync message. */
  private broadcastUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    const buf = msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength);
    for (const conn of this.getConnections()) conn.send(buf);
  }

  /** Replace the body Y.Text with `text`, editing only the changed middle so
   *  cursors and unaffected ranges survive. Tagged SERVER_ORIGIN so the update
   *  handler broadcasts it. */
  private replaceBodyFromText(text: string) {
    const body = this.doc!.getText("body");
    const old = body.toString();
    if (old === text) return;
    let p = 0;
    const max = Math.min(old.length, text.length);
    while (p < max && old[p] === text[p]) p++;
    let s = 0;
    while (s < max - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
    Y.transact(
      this.doc!,
      () => {
        const removeLen = old.length - p - s;
        if (removeLen > 0) body.delete(p, removeLen);
        const insert = text.slice(p, text.length - s);
        if (insert) body.insert(p, insert);
      },
      SERVER_ORIGIN,
    );
  }

  /**
   * Reconcile the open doc with the backend file (#9). If the file changed
   * upstream (edited in Obsidian/Drive) since this session's baseline, pull the
   * new content in when the body has no unsaved local edits, so an external edit
   * appears in the editor. If there are local edits as well, leave both and tell
   * the client (it shows a reload affordance) rather than discarding either.
   * `force` pulls regardless, for an explicit user reload.
   */
  private async checkUpstream(force: boolean): Promise<void> {
    if (this.isContaminated()) return;
    const now = Date.now();
    if (!force && now - this.lastUpstreamCheck < UPSTREAM_CHECK_MS) return;
    this.lastUpstreamCheck = now;

    const bound = this.backendFor();
    if (!bound) return;

    const { text, version } = await bound.backend.read();
    const known = this.readStoredText("driveVersion");
    if (!force && version && version === known) return; // already current

    const body = this.doc!.getText("body");
    const local = body.toString();
    const base = this.readStoredText("lastCommitMd");
    // No edits made in this session that are not already written to Drive: the
    // body still equals what we last saw/saved. headRevisionId cannot tell a
    // genuine external edit from a stale re-upload (Google Drive for Desktop can
    // stamp a new revision on old content), so we never guess "newer"; we decide
    // on this fact alone.
    const noLocalEdits = base != null && local === base;

    const setBaseline = () => {
      if (version) {
        this.sql`
          INSERT INTO doc_state (key, value) VALUES ('driveVersion', ${textBlob(version)})
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `;
      }
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('lastCommitMd', ${textBlob(text)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
    };

    if (local === text) {
      // Already matches Drive; just re-anchor the baseline.
      setBaseline();
      return;
    }

    // Explicit user reload ("Load Drive version"). If the editor holds unsaved
    // edits, snapshot them to a sibling FIRST, so the reload can never destroy
    // work the user chose to overwrite (their "be careful where saves go").
    if (force) {
      if (!noLocalEdits) {
        try {
          await bound.backend.saveSibling?.(local, "gmist unsaved");
        } catch {
          // best-effort snapshot; do not block the reload on it
        }
      }
      this.replaceBodyFromText(text);
      setBaseline();
      this.broadcast(JSON.stringify({ type: "reloaded", hash: quickHash(text) }));
      return;
    }

    if (noLocalEdits) {
      // Drive differs but nothing is unsaved here. This is either a genuine
      // async handoff (edited elsewhere) or a stale re-upload, and we cannot
      // tell them apart. Never auto-overwrite: prompt the user to load the Drive
      // version with one click. Our last save is already in Drive's version
      // history, so nothing is at risk while it waits.
      this.broadcast(JSON.stringify({ type: "upstream-changed" }));
      return;
    }

    // Unsaved edits here AND Drive diverged: keep the live editor, preserve the
    // incoming Drive version as a sibling so nothing is lost, re-anchor to the
    // current Drive version so our own save lands (and never re-forks the same
    // revision), and tell the client to save its content back to the main file.
    let savedAs: string | null = null;
    try {
      savedAs = (await bound.backend.saveSibling?.(text, "drive copy")) ?? null;
    } catch {
      // best-effort: even if the sibling write fails we must not overwrite.
    }
    setBaseline();
    this.broadcast(JSON.stringify({ type: "forked", name: savedAs }));
  }

  // Commits are serialised through this chain so two saves never race. Without
  // it, a manual save and the auto-save firing with identical content both read
  // the same baseline version, both write conditionally on it, and the second
  // write is rejected as "changed upstream" (the first bumped the version),
  // a false conflict that latches on the client and pauses all auto-save.
  private commitChain: Promise<void> = Promise.resolve();

  private commitPending(): Promise<void> {
    // catch keeps the chain alive: one failed commit must not block later ones.
    this.commitChain = this.commitChain.then(() => this.doCommit()).catch(() => {});
    return this.commitChain;
  }

  private async doCommit(): Promise<void> {
    // Only ever reached via an explicit save (handleControl requires commitNow).
    // The doc resets per id (keyed provider + SPA nav), so a save writes this
    // doc's own content, and the frontmatter round-trips verbatim. No banner is
    // injected, to keep saved files faithful.
    const pending = this.readStoredText("pendingMd");
    if (pending == null) return;
    if (this.readStoredText("lastCommitMd") === pending) {
      // Nothing to write (e.g. the client is re-saving content we just pulled
      // from Drive). Confirm it as saved so the client clears its unsaved badge.
      this.broadcast(JSON.stringify({ type: "committed", hash: quickHash(pending) }));
      return;
    }

    const bound = this.backendFor();
    if (!bound) return; // commit-back not configured on this server

    // Write conditionally on the version we last saw, so an edit made in
    // Obsidian/Drive while a session is open is never clobbered. On a version
    // mismatch the backend throws; we surface a conflict and leave the edits
    // pending rather than overwriting.
    const expected = this.readStoredText("driveVersion");
    try {
      const { version } = await bound.backend.write(pending, expected, `Update ${bound.label} via mist`);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('lastCommitMd', ${textBlob(pending)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      if (version) {
        this.sql`
          INSERT INTO doc_state (key, value) VALUES ('driveVersion', ${textBlob(version)})
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `;
      }
      // broadcast() is the agents framework's send-to-all-connections helper.
      this.broadcast(JSON.stringify({ type: "committed", hash: quickHash(pending) }));
    } catch (err) {
      const conflict = err instanceof Error && /changed upstream/.test(err.message);
      if (conflict) this.broadcast(JSON.stringify({ type: "conflict" }));
      // Leave the edits pending: a conflict pauses auto-save (the client gates
      // on it) until the two versions are reconciled. We never clobber.
    }
  }

  async onRequest(request: Request) {
    if (request.method === "POST") {
      // Create / initialise the document
      const { doc } = this.ensureInitialised();

      // Creation is one-shot: re-posting an existing id must not leak its keys
      const existsRows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'exists'
      `;
      if (existsRows.length > 0) {
        return new Response(JSON.stringify({ ok: false, error: "document already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { editKey, suggestKey } = this.ensureKeys();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('exists', ${sqlBlob(new Uint8Array([1]))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // Stamp doc format version and the document's own id in Yjs metadata.
      // The docId stamp is the anchor for the contamination guard: any state
      // whose stamp stops matching this DO's name is a cross-doc merge.
      const meta = doc.getMap("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }
      stampDocId(doc, this.name);

      // Store creation timestamp
      const now = Date.now();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('createdAt', ${sqlBlob(new Uint8Array(new Float64Array([now]).buffer))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean; drive?: DriveMeta; frontmatter?: string; driveVersion?: string | null };
          if (body.drive) {
            const d = body.drive;
            this.sql`
              INSERT INTO doc_state (key, value) VALUES ('drive', ${textBlob(JSON.stringify({ fileId: d.fileId, name: d.name, folderId: d.folderId }))})
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `;
            // The file's version at open: the baseline for conditional writes.
            if (body.driveVersion) {
              this.sql`
                INSERT INTO doc_state (key, value) VALUES ('driveVersion', ${textBlob(body.driveVersion)})
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
              `;
            }
          }
          if (body.content) {
            // Y.Text core (#13): seed the raw markdown body verbatim into
            // getText("body"). The CodeMirror editor binds to this, and save is
            // ytext.toString() (an identity), so the round-trip is byte-faithful.
            const ytextBody = doc.getText("body");
            if (ytextBody.length === 0) {
              ytextBody.insert(0, body.content);
            }
            // The seed came from the backend at driveVersion, so record it as the
            // baseline: the upstream-sync check treats a body still equal to this
            // as having no local edits, and so safe to refresh from Drive.
            this.sql`
              INSERT INTO doc_state (key, value) VALUES ('lastCommitMd', ${textBlob(body.content)})
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `;
          }
          if (body.threads && Array.isArray(body.threads)) {
            const threadsMap = doc.getMap<string>("threads");
            for (const thread of body.threads) {
              const t = thread as { id?: string };
              if (t.id) {
                threadsMap.set(t.id, JSON.stringify(thread));
              }
            }
          }
          if (body.onboarding) {
            const docState = doc.getMap<string>("docState");
            docState.set("onboarding", "true");
          }
        } catch (err) {
          // If it's an unsupported CriticMarkup error, return it
          if (err instanceof Error && err.message.includes("Unsupported CriticMarkup")) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Ignore other malformed JSON — document is still created
        }
      }

      return new Response(JSON.stringify({ ok: true, editKey, suggestKey }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      // Check whether this document exists
      this.ensureInitialised();
      const rows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'exists'
      `;
      const exists = rows.length > 0;

      const createdAtRows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'createdAt'
      `;
      const createdAt =
        createdAtRows.length > 0
          ? new Float64Array(createdAtRows[0].value)[0]
          : null;

      const k = new URL(request.url).searchParams.get("k");
      const role = exists ? this.roleForKey(k) : null;

      const driveRaw = role ? this.readStoredText("drive") : null;
      const drive = driveRaw ? (JSON.parse(driveRaw) as DriveMeta) : null;

      return new Response(
        JSON.stringify({
          exists,
          createdAt,
          role,
          // Edit-role callers get the suggest key so they can share suggest links
          suggestKey: role === "edit" ? this.readStoredText("suggestKey") : undefined,
          drive,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }

  private broadcastBinary(message: WSMessage, excludeId: string) {
    // Make a clean copy to avoid ArrayBufferView offset issues
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      if (conn.id !== excludeId) {
        conn.send(buf);
      }
    }
  }
}

export default DocumentAgent;
