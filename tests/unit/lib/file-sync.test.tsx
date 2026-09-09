// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFileSync, type FileSyncBuffer, type OfferReason } from "~/lib/useFileSync";

/**
 * The rules both local editors keep, tested once.
 *
 * These are the behaviours that were fixed in one editor and not the other three
 * times running, which is why the layer exists at all. A fake disk and a fake
 * buffer are enough: nothing here is about CodeMirror or Yjs, and the point of
 * the seam is that it does not know which one it is talking to.
 */

/** A file, and a hash that changes with its content. */
class FakeDisk {
  text: string;
  version: string;
  writes: { body: string; expected: string | null }[] = [];
  refuseNext = false;

  constructor(text: string) {
    this.text = text;
    this.version = hash(text);
  }

  set(text: string) {
    this.text = text;
    this.version = hash(text);
  }
}

function hash(s: string) {
  return `v${s.length}-${[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99991, 7)}`;
}

/** A buffer that is simply the file's text, the simpler of the two editors. */
function plainBuffer(): FileSyncBuffer & { text: string | null; type(s: string): void } {
  return {
    text: null,
    normalise: (t) => t,
    held() {
      return this.text;
    },
    put(t) {
      this.text = t;
    },
    serialise() {
      return this.text;
    },
    type(s: string) {
      this.text = s;
    },
  };
}

let disk: FakeDisk;

beforeEach(() => {
  disk = new FakeDisk("one\ntwo\nthree\n");
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://local");
    if (init?.method === "POST" && url.pathname === "/local/doc") {
      const expected = url.searchParams.get("expected");
      const body = String(init.body);
      disk.writes.push({ body, expected });
      if (disk.refuseNext || (expected && expected !== disk.version)) {
        disk.refuseNext = false;
        return new Response("{}", { status: 409 });
      }
      disk.set(body);
      return Response.json({ version: disk.version });
    }
    if (url.pathname === "/local/recovery") return Response.json({ saved: "copy.md" });
    if (url.searchParams.has("stat")) return Response.json({ version: disk.version });
    return Response.json({ text: disk.text, version: disk.version });
  });
  // The lock is not what these tests are about, and jsdom has no Web Locks.
  vi.stubGlobal("navigator", { ...globalThis.navigator, locks: undefined, sendBeacon: () => true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(buffer: FileSyncBuffer, events = {}) {
  return renderHook(() => useFileSync("lf_test", buffer, events));
}

describe("useFileSync", () => {
  it("seeds the buffer from the file and reports ready", async () => {
    const buf = plainBuffer();
    const { result } = mount(buf);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(buf.text).toBe("one\ntwo\nthree\n");
  });

  it("takes somebody else's new work silently", async () => {
    const buf = plainBuffer();
    const adopted: string[] = [];
    const { result } = mount(buf, { onAdopted: (t: string) => adopted.push(t) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    disk.set("one\ntwo\nthree\nfour from an agent\n");
    await act(async () => {
      await result.current.check();
    });

    expect(buf.text).toBe("one\ntwo\nthree\nfour from an agent\n");
    expect(adopted).toHaveLength(1);
  });

  it("offers rather than takes when the file goes back to a version already seen", async () => {
    const buf = plainBuffer();
    const offers: OfferReason[] = [];
    const { result } = mount(buf, { onOffered: (w: OfferReason) => offers.push(w) });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const original = disk.text;

    disk.set(original + "an agent's paragraph, long enough to be a real edit\n");
    await act(async () => {
      await result.current.check();
    });
    expect(offers).toHaveLength(0);

    // Something puts the file back to where it started: a revert, not new work.
    disk.set(original);
    await act(async () => {
      await result.current.check();
    });

    expect(offers).toEqual(["reverted"]);
    expect(buf.text).toBe(original + "an agent's paragraph, long enough to be a real edit\n");
  });

  it("offers rather than takes when a material amount of text has gone", async () => {
    const buf = plainBuffer();
    const offers: OfferReason[] = [];
    disk = new FakeDisk("x".repeat(50000));
    const { result } = mount(buf, { onOffered: (w: OfferReason) => offers.push(w) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    disk.set("x".repeat(49000));
    await act(async () => {
      await result.current.check();
    });

    expect(offers).toEqual(["shrank"]);
    expect(buf.held()).toHaveLength(50000);
  });

  it("offers rather than takes while the buffer has unsaved edits", async () => {
    const buf = plainBuffer();
    const offers: OfferReason[] = [];
    const { result } = mount(buf, { onOffered: (w: OfferReason) => offers.push(w) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    buf.type("one\ntwo\nthree\nmine, still unsaved\n");
    disk.set("one\ntwo\nthree\nsomebody else's, also new\n");
    await act(async () => {
      await result.current.check();
    });

    expect(offers).toEqual(["dirty"]);
    expect(buf.text).toBe("one\ntwo\nthree\nmine, still unsaved\n");
  });

  it("announces one offer per version, not one per poll", async () => {
    const buf = plainBuffer();
    const offers: OfferReason[] = [];
    const { result } = mount(buf, { onOffered: (w: OfferReason) => offers.push(w) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    buf.type("mine\n");
    disk.set("one\ntwo\nthree\ntheirs\n");
    await act(async () => {
      await result.current.check();
      await result.current.check();
      await result.current.check();
    });

    expect(offers).toHaveLength(1);
  });

  it("carries the version it loaded on every write", async () => {
    const buf = plainBuffer();
    const { result } = mount(buf);
    await waitFor(() => expect(result.current.ready).toBe(true));
    const loaded = disk.version;

    buf.type("one\ntwo\nthree\nand mine\n");
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(disk.writes).toHaveLength(1));

    expect(disk.writes[0].expected).toBe(loaded);
    expect(disk.text).toBe("one\ntwo\nthree\nand mine\n");
  });

  it("stops writing once a write is refused", async () => {
    const buf = plainBuffer();
    let conflicts = 0;
    const { result } = mount(buf, { onConflict: () => (conflicts += 1) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    // The file moves under us, so the baseline we hold is stale.
    disk.set("rewritten by something else\n");
    buf.type("one\ntwo\nthree\nand mine\n");
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(conflicts).toBe(1));

    const after = disk.writes.length;
    await act(async () => {
      result.current.save();
      result.current.save();
    });
    expect(disk.writes).toHaveLength(after);
    expect(disk.text).toBe("rewritten by something else\n");
  });

  it("does not poll a file another window holds", async () => {
    const buf = plainBuffer();
    // A real Web Locks implementation that never grants, which is what a second
    // window sees while the first one is open.
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      locks: { request: () => new Promise(() => {}) },
    });
    const { result } = mount(buf);
    await waitFor(() => expect(result.current.alreadyOpen).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(buf.text).toBeNull();
  });

  it("keeps a copy beside the file before anything replaces the buffer", async () => {
    const buf = plainBuffer();
    const { result } = mount(buf);
    await waitFor(() => expect(result.current.ready).toBe(true));
    buf.type("work worth keeping\n");

    let saved: string | null = null;
    await act(async () => {
      saved = await result.current.saveRecovery();
    });
    expect(saved).toBe("copy.md");
  });

  it("takes the file from disk when the user asks for it", async () => {
    const buf = plainBuffer();
    const { result } = mount(buf);
    await waitFor(() => expect(result.current.ready).toBe(true));

    buf.type("mine\n");
    disk.set("theirs\n");
    await act(async () => {
      result.current.halt();
      await result.current.takeDisk();
    });

    expect(buf.text).toBe("theirs\n");

    // And writing resumes, on the new baseline.
    buf.type("theirs, plus mine\n");
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(disk.text).toBe("theirs, plus mine\n"));
  });

  it("normalises the incoming file through the buffer before comparing", async () => {
    // The Yjs editor's buffer is not the file's bytes: the frontmatter is
    // rewritten on the way in. Comparing raw file length against buffer length
    // would read that difference as text going missing.
    const frontmatter = "---\nmist:\n  threads: []\n---\n";
    const body = "y".repeat(3000);
    disk = new FakeDisk(frontmatter + body);
    const offers: OfferReason[] = [];
    const buf: FileSyncBuffer = {
      text: null as string | null,
      normalise: (t) => t.replace(frontmatter, ""),
      held() {
        return this.text;
      },
      put(t: string) {
        this.text = this.normalise(t);
      },
      serialise() {
        return this.text;
      },
    } as FileSyncBuffer & { text: string | null };

    const { result } = mount(buf, { onOffered: (w: OfferReason) => offers.push(w) });
    await waitFor(() => expect(result.current.ready).toBe(true));

    disk.set(frontmatter + body + "z");
    await act(async () => {
      await result.current.check();
    });

    expect(offers).toHaveLength(0);
    expect(buf.held()).toBe(body + "z");
  });
});
