import { describe, it, expect } from "vitest";
import {
  serializeThreads,
  deserializeThreads,
  stripFrontmatter,
  parseFrontmatter,
} from "~/lib/thread-serialization";
import type { ThreadData } from "~/shared/types";

function makeThread(overrides: Partial<ThreadData> = {}): ThreadData {
  return {
    id: "t1",
    commentText: "This needs work",
    author: { name: "Jane", color: "#E57373", colorLight: "#FFCDD2" },
    createdAt: 1707400200000,
    resolved: false,
    replies: [],
    ...overrides,
  };
}

describe("serializeThreads", () => {
  it("no threads → no frontmatter added", () => {
    const result = serializeThreads("# Hello\n\nWorld", []);
    expect(result).toBe("# Hello\n\nWorld");
  });

  it("one thread → correct YAML frontmatter", () => {
    const md = "Some text {>>This needs work<<}";
    const threads = [makeThread()];
    const result = serializeThreads(md, threads);

    expect(result).toMatch(/^---\n/);
    expect(result).toContain("mist:");
    expect(result).toContain("threads:");
    expect(result).toContain("comment: This needs work");
    expect(result).toContain("author: Jane");
    expect(result).toContain("resolved: false");
    // Body preserved after frontmatter
    expect(result).toContain("---\n\nSome text {>>This needs work<<}");
  });

  it("thread with replies → replies serialized", () => {
    const threads = [
      makeThread({
        replies: [
          {
            id: "r1",
            author: { name: "Bob", color: "#64B5F6", colorLight: "#BBDEFB" },
            text: "I'll expand this",
            createdAt: 1707403800000,
          },
        ],
      }),
    ];
    const result = serializeThreads("text {>>This needs work<<}", threads);
    expect(result).toContain("replies:");
    expect(result).toContain("author: Bob");
    expect(result).toContain("text: I'll expand this");
  });

  it("resolved thread → resolved: true", () => {
    const threads = [makeThread({ resolved: true })];
    const result = serializeThreads("text {>>This needs work<<}", threads);
    expect(result).toContain("resolved: true");
  });

  it("thread with highlight → highlight field present", () => {
    const threads = [
      makeThread({ highlightText: "important section" }),
    ];
    const result = serializeThreads(
      "text {==important section==}{>>This needs work<<}",
      threads,
    );
    expect(result).toContain("highlight: important section");
  });

  it("existing frontmatter preserved (non-mist keys kept)", () => {
    const md = "---\ntitle: My Doc\ntags:\n  - draft\n---\n\nSome text {>>A comment<<}";
    const threads = [makeThread({ commentText: "A comment" })];
    const result = serializeThreads(md, threads);
    expect(result).toContain("title: My Doc");
    expect(result).toContain("tags:");
    expect(result).toContain("- draft");
    expect(result).toContain("mist:");
    expect(result).toContain("comment: A comment");
  });

  it("multiple threads → all serialized", () => {
    const threads = [
      makeThread({ id: "t1", commentText: "First" }),
      makeThread({ id: "t2", commentText: "Second" }),
    ];
    const result = serializeThreads(
      "{>>First<<} and {>>Second<<}",
      threads,
    );
    expect(result).toContain("comment: First");
    expect(result).toContain("comment: Second");
  });

  it("baseFrontmatter with no threads → frontmatter emitted (deck config kept)", () => {
    const fm = "format:\n  revealjs:\n    theme: dark\ncss: styles.css\n";
    const result = serializeThreads("# Slide one\n\nText", [], fm);
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("theme: dark");
    expect(result).toContain("css: styles.css");
    expect(result).toContain("---\n\n# Slide one");
    expect(result).not.toContain("mist:");
  });

  it("preserves frontmatter verbatim (quotes, key order) with no threads", () => {
    const fm = 'pagetitle: "Causal Map features"\nauthor: "Steve Powell"\ndate: "21 May 2026"\n';
    const result = serializeThreads("# Slide\n\nBody", [], fm);
    expect(result).toBe(`---\n${fm}---\n\n# Slide\n\nBody`);
    expect(result).toContain('pagetitle: "Causal Map features"'); // quotes not stripped
  });

  it("baseFrontmatter plus threads → both deck config and mist kept", () => {
    const fm = "title: Deck\n";
    const result = serializeThreads("text {>>A comment<<}", [makeThread({ commentText: "A comment" })], fm);
    expect(result).toContain("title: Deck");
    expect(result).toContain("mist:");
    expect(result).toContain("comment: A comment");
  });

  it("thread with empty replies array → no replies key", () => {
    const threads = [makeThread({ replies: [] })];
    const result = serializeThreads("text {>>This needs work<<}", threads);
    expect(result).not.toContain("replies:");
  });

  it("comment text with YAML special chars", () => {
    const threads = [
      makeThread({ commentText: 'Contains: colon, # hash, "quotes"' }),
    ];
    const result = serializeThreads(
      '{>>Contains: colon, # hash, "quotes"<<}',
      threads,
    );
    // Should produce valid YAML — re-parse to verify
    const parsed = parseFrontmatter(result);
    const mistThreads = (parsed.mist as { threads: unknown[] }).threads;
    expect(mistThreads).toHaveLength(1);
    expect((mistThreads[0] as { comment: string }).comment).toBe(
      'Contains: colon, # hash, "quotes"',
    );
  });
});

describe("deserializeThreads", () => {
  it("frontmatter with one thread → ThreadData parsed", () => {
    const md = `---
mist:
  threads:
    - comment: "This needs work"
      author: Jane
      color: "#E57373"
      created: 2024-02-08T14:30:00.000Z
      resolved: false
---

Some text {>>This needs work<<}`;

    const { body, threads } = deserializeThreads(md);
    expect(body).toBe("Some text {>>This needs work<<}");
    expect(threads).toHaveLength(1);
    expect(threads[0].commentText).toBe("This needs work");
    expect(threads[0].author.name).toBe("Jane");
    expect(threads[0].author.color).toBe("#E57373");
    expect(threads[0].resolved).toBe(false);
  });

  it("frontmatter with replies → replies array restored", () => {
    const md = `---
mist:
  threads:
    - comment: "Fix this"
      author: Jane
      color: "#E57373"
      created: 2024-02-08T14:30:00.000Z
      resolved: false
      replies:
        - author: Bob
          color: "#64B5F6"
          text: "Done"
          created: 2024-02-08T15:00:00.000Z
---

Text {>>Fix this<<}`;

    const { threads } = deserializeThreads(md);
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].author.name).toBe("Bob");
    expect(threads[0].replies[0].text).toBe("Done");
  });

  it("missing mist.threads key → empty threads array", () => {
    const md = `---
title: My Doc
---

Some text`;

    const { body, threads } = deserializeThreads(md);
    expect(threads).toEqual([]);
    expect(body).toBe("Some text");
  });

  it("no frontmatter → empty threads array", () => {
    const { body, threads } = deserializeThreads("# Hello\n\nWorld");
    expect(threads).toEqual([]);
    expect(body).toBe("# Hello\n\nWorld");
  });

  it("returns non-mist frontmatter as YAML, mist key removed", () => {
    const md = `---
title: My Deck
format:
  revealjs:
    theme: dark
mist:
  threads:
    - comment: "Note"
      author: Jane
      color: "#E57373"
      created: 2024-02-08T14:30:00.000Z
      resolved: false
---

Text {>>Note<<}`;
    const { frontmatter, threads } = deserializeThreads(md);
    expect(threads).toHaveLength(1);
    expect(frontmatter).toContain("title: My Deck");
    expect(frontmatter).toContain("theme: dark");
    expect(frontmatter).not.toContain("mist");
    expect(frontmatter).not.toContain("Note");
  });

  it("no frontmatter → frontmatter is empty string", () => {
    const { frontmatter } = deserializeThreads("# Hello\n\nWorld");
    expect(frontmatter).toBe("");
  });

  it("thread with highlight → highlightText populated", () => {
    const md = `---
mist:
  threads:
    - comment: "Needs detail"
      highlight: "The intro"
      author: Jane
      color: "#E57373"
      created: 2024-02-08T14:30:00.000Z
      resolved: false
---

{==The intro==}{>>Needs detail<<}`;

    const { threads } = deserializeThreads(md);
    expect(threads[0].highlightText).toBe("The intro");
    expect(threads[0].commentText).toBe("Needs detail");
  });

  it("malformed YAML → graceful error handling", () => {
    const md = `---
mist: {{{invalid
---

Some text`;

    const { body, threads } = deserializeThreads(md);
    expect(threads).toEqual([]);
    expect(body).toBe("Some text");
  });

  it("frontmatter with extra unknown keys under mist → preserved on roundtrip", () => {
    const md = `---
mist:
  version: 2
  threads:
    - comment: "Note"
      author: Jane
      color: "#E57373"
      created: 2024-02-08T14:30:00.000Z
      resolved: false
---

Text {>>Note<<}`;

    const { threads } = deserializeThreads(md);
    expect(threads).toHaveLength(1);
    expect(threads[0].commentText).toBe("Note");
  });
});

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter", () => {
    const md = `---
title: Test
---

# Hello`;
    expect(stripFrontmatter(md)).toBe("# Hello");
  });

  it("returns body as-is when no frontmatter", () => {
    expect(stripFrontmatter("# Hello\n\nWorld")).toBe("# Hello\n\nWorld");
  });

  it("handles empty frontmatter", () => {
    const md = "---\n\n---\n\nContent";
    expect(stripFrontmatter(md)).toBe("Content");
  });
});

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter to object", () => {
    const md = `---
title: Test
tags:
  - a
  - b
---

Body`;
    const fm = parseFrontmatter(md);
    expect(fm.title).toBe("Test");
    expect(fm.tags).toEqual(["a", "b"]);
  });

  it("returns empty object when no frontmatter", () => {
    expect(parseFrontmatter("# Hello")).toEqual({});
  });

  it("returns empty object for malformed YAML", () => {
    const md = `---
{{{bad
---

Body`;
    expect(parseFrontmatter(md)).toEqual({});
  });
});

describe("roundtrip", () => {
  it("serialize then deserialize preserves thread data", () => {
    const originalThreads = [
      makeThread({
        commentText: "Important note",
        highlightText: "key section",
        replies: [
          {
            id: "r1",
            author: { name: "Bob", color: "#64B5F6", colorLight: "#BBDEFB" },
            text: "Agreed",
            createdAt: 1707403800000,
          },
        ],
      }),
    ];
    const originalBody = "{==key section==}{>>Important note<<}";

    const serialized = serializeThreads(originalBody, originalThreads);
    const { body, threads } = deserializeThreads(serialized);

    expect(body).toBe(originalBody);
    expect(threads).toHaveLength(1);
    expect(threads[0].commentText).toBe("Important note");
    expect(threads[0].highlightText).toBe("key section");
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].text).toBe("Agreed");
    expect(threads[0].replies[0].author.name).toBe("Bob");
  });

  it("roundtrip preserves non-mist frontmatter keys", () => {
    const md = "---\ntitle: My Doc\n---\n\nText {>>Comment<<}";
    const { body } = deserializeThreads(md);
    const threads = [makeThread({ commentText: "Comment" })];

    const result = serializeThreads(md, threads);
    expect(result).toContain("title: My Doc");
    expect(result).toContain("comment: Comment");

    const round2 = deserializeThreads(result);
    expect(round2.body).toBe(body);
    expect(round2.threads).toHaveLength(1);
  });

  it("import then commit-back keeps quoted YAML byte-for-byte", () => {
    const file = '---\npagetitle: "Causal Map features"\nfooter: "a ?? b"\n---\n\n## Slide\n\nBody';
    const { body, frontmatter } = deserializeThreads(file);
    const committed = serializeThreads(body, [], frontmatter);
    expect(committed).toBe(file); // exact round-trip, no quote-stripping or reorder
  });

  it("deck frontmatter survives import then commit-back via the doc", () => {
    // The frontmatter is kept separate (verbatim in the doc), not in the editor
    // body, so the editor round-trip cannot mangle the multi-line YAML.
    const file = `---
format:
  revealjs:
    theme: dark
css: assets/deck.css
---

## Slide one

Body`;
    const { body, frontmatter } = deserializeThreads(file);
    // body reaches the editor with no frontmatter
    expect(body).toContain("## Slide one");
    expect(body).not.toContain("theme:");
    // committing the edited body back, with the doc's frontmatter, re-emits it
    const committed = serializeThreads(body, [], frontmatter);
    expect(committed).toContain("theme: dark");
    expect(committed).toContain("css: assets/deck.css");
    expect(committed).toContain("## Slide one");
  });
});
