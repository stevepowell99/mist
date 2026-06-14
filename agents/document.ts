import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOC_FORMAT_VERSION } from "../app/shared/constants";
import type { DocRole, DriveMeta, GitHubMeta } from "../app/shared/types";
import { type DocBackend, DriveBackend } from "../app/lib/backend.server";
import { type DriveEnv, driveConfigured } from "../app/lib/google.server";
import { quickHash } from "../app/shared/hash";

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

    // Persist on every update
    this.doc.on("update", () => {
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
    });

    return { doc: this.doc, awareness: this.awareness };
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
   * serialized markdown of a GitHub-backed document, which is auto-committed
   * back to the repo on a throttle (or immediately when `commitNow` is set).
   */
  private async handleControl(raw: string) {
    let msg: { type?: string; content?: string; commitNow?: boolean };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.type !== "doc" || typeof msg.content !== "string") return;
    // only backend-bound docs (GitHub or Drive) commit back
    if (!this.readStoredText("github") && !this.readStoredText("drive")) return;
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

  /** The storage backend this doc is bound to (Drive preferred), with a label
   *  for the commit message. Null if none is bound or it is unconfigured. */
  private backendFor(): { backend: DocBackend; label: string } | null {
    const driveRaw = this.readStoredText("drive");
    if (driveRaw) {
      const env = this.env as unknown as DriveEnv;
      if (!driveConfigured(env)) return null;
      const drive = JSON.parse(driveRaw) as DriveMeta;
      return { backend: new DriveBackend(drive, env), label: drive.name ?? drive.fileId };
    }
    // GitHub commit-back disabled (14 June 2026): when a file lives in both git
    // and Drive, mist must not also sync via git. Drive is the only write path.
    return null;
  }

  private async commitPending(): Promise<void> {
    // Only ever reached via an explicit save (handleControl requires commitNow).
    // The doc resets per id (keyed provider + SPA nav), so a save writes this
    // doc's own content, and the frontmatter round-trips verbatim. No banner is
    // injected, to keep saved files faithful.
    const pending = this.readStoredText("pendingMd");
    if (pending == null) return;
    if (this.readStoredText("lastCommitMd") === pending) return; // unchanged since last commit

    const bound = this.backendFor();
    if (!bound) return; // commit-back not configured on this server

    try {
      await bound.backend.write(pending, null, `Update ${bound.label} via mist`);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('lastCommitMd', ${textBlob(pending)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      // Tell connected clients which content is now saved, so they can show a
      // clean state and clear the unsaved warning.
      const ack = JSON.stringify({ type: "committed", hash: quickHash(pending) });
      for (const conn of this.getConnections()) {
        try {
          conn.send(ack);
        } catch {
          // connection gone; ignore
        }
      }
    } catch {
      // Leave pending in place; the next edit or alarm retries.
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

      // Stamp doc format version in Yjs metadata
      const meta = doc.getMap<number>("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }

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
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean; github?: GitHubMeta; drive?: DriveMeta; frontmatter?: string };
          if (body.frontmatter) {
            // The file's own YAML frontmatter (theme, css, format, title...),
            // kept in the doc so it round-trips on commit-back rather than being
            // lost on import. The body text never carries it.
            doc.getMap<string>("meta").set("frontmatter", body.frontmatter);
          }
          if (body.github) {
            const g = body.github;
            this.sql`
              INSERT INTO doc_state (key, value) VALUES ('github', ${textBlob(JSON.stringify({ owner: g.owner, repo: g.repo, branch: g.branch, path: g.path }))})
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `;
          }
          if (body.drive) {
            const d = body.drive;
            this.sql`
              INSERT INTO doc_state (key, value) VALUES ('drive', ${textBlob(JSON.stringify({ fileId: d.fileId, name: d.name, folderId: d.folderId }))})
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `;
          }
          if (body.content) {
            // Parse CriticMarkup and apply as marks on XmlText
            const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
            const frag = doc.getXmlFragment("default");
            if (frag.length === 0) {
              const lines = body.content.split("\n");
              for (const line of lines) {
                const { cleanText, marks } = parseCriticMarkupToContent(line);
                const para = new Y.XmlElement("paragraph");
                const ytext = new Y.XmlText(cleanText);
                // Apply marks via Yjs formatting attributes
                for (const mark of marks) {
                  const attrs: Record<string, Record<string, unknown>> = {};
                  attrs[mark.type] = mark.attrs ?? {};
                  ytext.format(mark.from, mark.to - mark.from, attrs);
                }
                para.insert(0, [ytext]);
                frag.insert(frag.length, [para]);
              }
            }
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

      const githubRaw = role ? this.readStoredText("github") : null;
      const github = githubRaw ? (JSON.parse(githubRaw) as GitHubMeta) : null;
      const driveRaw = role ? this.readStoredText("drive") : null;
      const drive = driveRaw ? (JSON.parse(driveRaw) as DriveMeta) : null;

      return new Response(
        JSON.stringify({
          exists,
          createdAt,
          role,
          // Edit-role callers get the suggest key so they can share suggest links
          suggestKey: role === "edit" ? this.readStoredText("suggestKey") : undefined,
          github,
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
