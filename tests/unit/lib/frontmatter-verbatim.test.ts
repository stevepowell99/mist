import { serializeThreads, deserializeThreads } from "~/lib/thread-serialization";
import { describe, expect, it } from "vitest";

describe("frontmatter is the author's text, not ours", () => {
  const original = [
    "---",
    "title: 'Rubicon: the principles'",
    "tags:   [one, two]",
    "bibliography: ~/My Drive/MyLibrary.bib",
    "---",
    "",
    "Body text.",
  ].join(String.fromCharCode(10));

  it("round-trips an untouched header unchanged when there are no threads", () => {
    const d = deserializeThreads(original);
    expect(serializeThreads(d.body, [], d.frontmatter)).toBe(original);
  });

  it("keeps every key as written when threads are added", () => {
    const d = deserializeThreads(original);
    const out = serializeThreads(d.body, [{
      id: "t1", commentText: "a note", highlightText: "Body",
      author: { name: "sp", color: "#AED581" },
      createdAt: Date.parse("2026-09-08T09:00:00Z"), resolved: false, replies: [],
    } as never], d.frontmatter);
    expect(out).toContain("title: 'Rubicon: the principles'");
    expect(out).toContain("tags:   [one, two]");
    expect(out).toContain("bibliography: ~/My Drive/MyLibrary.bib");
    expect(out).toContain("mist:");
  });
});
