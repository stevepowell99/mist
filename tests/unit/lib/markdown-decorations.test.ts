import { describe, it, expect } from "vitest";
import {
  MARKDOWN_PATTERNS,
  findDecorations,
  findCodeBlockDecorations,
  CODE_FENCE_REGEX,
  highlightLine,
  getLanguageOptions,
  type MarkdownPattern,
} from "~/lib/markdown-decorations";

function getPattern(name: string): MarkdownPattern {
  const p = MARKDOWN_PATTERNS.find((p) => p.name === name);
  if (!p) throw new Error(`Pattern ${name} not found`);
  return p;
}

function matchPositions(text: string, pattern: MarkdownPattern) {
  return findDecorations(text, 0, pattern).map((d) => ({
    from: d.from,
    to: d.to,
    // Decoration.inline stores the attrs object directly in spec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class: (d as any).type.attrs?.class,
  }));
}

describe("MARKDOWN_PATTERNS", () => {
  it("exports all expected pattern names", () => {
    const names = MARKDOWN_PATTERNS.map((p) => p.name);
    expect(names).toContain("bold");
    expect(names).toContain("italic");
    expect(names).toContain("code");
    expect(names).toContain("strikethrough");
    expect(names).toContain("heading");
    expect(names).toContain("link");
    expect(names).toContain("blockquote");
    expect(names).toContain("list");
    expect(names).toContain("hr");
  });
});

describe("findDecorations", () => {
  describe("bold", () => {
    const pattern = getPattern("bold");

    it("decorates **bold** text", () => {
      const decos = matchPositions("hello **world** end", pattern);
      expect(decos).toEqual([
        { from: 6, to: 8, class: "md-delimiter" },
        { from: 8, to: 13, class: "md-bold" },
        { from: 13, to: 15, class: "md-delimiter" },
      ]);
    });

    it("handles multiple bold spans", () => {
      const decos = matchPositions("**a** and **b**", pattern);
      expect(decos).toHaveLength(6);
    });

    it("returns nothing for unmatched text", () => {
      const decos = matchPositions("no bold here", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("italic", () => {
    const pattern = getPattern("italic");

    it("decorates *italic* text", () => {
      const decos = matchPositions("hello *world* end", pattern);
      expect(decos).toEqual([
        { from: 6, to: 7, class: "md-delimiter" },
        { from: 7, to: 12, class: "md-italic" },
        { from: 12, to: 13, class: "md-delimiter" },
      ]);
    });
  });

  describe("code", () => {
    const pattern = getPattern("code");

    it("decorates `code` text", () => {
      const decos = matchPositions("use `npm install` here", pattern);
      expect(decos).toEqual([
        { from: 4, to: 5, class: "md-delimiter" },
        { from: 5, to: 16, class: "md-code" },
        { from: 16, to: 17, class: "md-delimiter" },
      ]);
    });
  });

  describe("strikethrough", () => {
    const pattern = getPattern("strikethrough");

    it("decorates ~~strikethrough~~ text", () => {
      const decos = matchPositions("~~removed~~ text", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
        { from: 2, to: 9, class: "md-strikethrough" },
        { from: 9, to: 11, class: "md-delimiter" },
      ]);
    });
  });

  describe("heading", () => {
    const pattern = getPattern("heading");

    it("decorates # heading with delimiter and content", () => {
      const decos = matchPositions("# Hello", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-heading-delimiter" },
        { from: 2, to: 7, class: "md-heading md-heading-1" },
      ]);
    });

    it("decorates ## level 2 heading", () => {
      const decos = matchPositions("## Hello", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-heading-delimiter" },
        { from: 3, to: 8, class: "md-heading md-heading-2" },
      ]);
    });

    it("decorates ### level 3 heading", () => {
      const decos = matchPositions("### Sub", pattern);
      expect(decos).toEqual([
        { from: 0, to: 4, class: "md-heading-delimiter" },
        { from: 4, to: 7, class: "md-heading md-heading-3" },
      ]);
    });

    it("decorates ###### level 6 heading", () => {
      const decos = matchPositions("###### Deep", pattern);
      expect(decos).toEqual([
        { from: 0, to: 7, class: "md-heading-delimiter" },
        { from: 7, to: 11, class: "md-heading md-heading-6" },
      ]);
    });
  });

  describe("link", () => {
    const pattern = getPattern("link");

    it("decorates [text](url) with 5 parts", () => {
      const decos = matchPositions("[click here](https://example.com)", pattern);
      expect(decos).toEqual([
        { from: 0, to: 1, class: "md-delimiter" },        // [
        { from: 1, to: 11, class: "md-link-text" },        // click here
        { from: 11, to: 13, class: "md-delimiter" },       // ](
        { from: 13, to: 32, class: "md-link-url" },        // https://example.com
        { from: 32, to: 33, class: "md-delimiter" },       // )
      ]);
    });

    it("handles link in middle of text", () => {
      const decos = matchPositions("see [docs](http://x.co) here", pattern);
      expect(decos).toHaveLength(5);
      expect(decos[0]).toEqual({ from: 4, to: 5, class: "md-delimiter" });
      expect(decos[1]).toEqual({ from: 5, to: 9, class: "md-link-text" });
    });

    it("handles multiple links", () => {
      const decos = matchPositions("[a](b) [c](d)", pattern);
      expect(decos).toHaveLength(10);
    });
  });

  describe("blockquote", () => {
    const pattern = getPattern("blockquote");

    it("decorates > prefix", () => {
      const decos = matchPositions("> quote text", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("does not match > without space", () => {
      const decos = matchPositions(">nospace", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("list", () => {
    const pattern = getPattern("list");

    it("decorates - bullet", () => {
      const decos = matchPositions("- item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates * bullet", () => {
      const decos = matchPositions("* item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates + bullet", () => {
      const decos = matchPositions("+ item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates 1. numbered list", () => {
      const decos = matchPositions("1. first", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-delimiter" },
      ]);
    });

    it("decorates indented bullet", () => {
      const decos = matchPositions("  - nested", pattern);
      expect(decos).toEqual([
        { from: 0, to: 4, class: "md-delimiter" },
      ]);
    });
  });

  describe("hr", () => {
    const pattern = getPattern("hr");

    it("decorates ---", () => {
      const decos = matchPositions("---", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates ***", () => {
      const decos = matchPositions("***", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates ___", () => {
      const decos = matchPositions("___", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates longer rules", () => {
      const decos = matchPositions("-----", pattern);
      expect(decos).toEqual([
        { from: 0, to: 5, class: "md-hr" },
      ]);
    });

    it("does not match fewer than 3 characters", () => {
      const decos = matchPositions("--", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("basePos offset", () => {
    it("offsets all decoration positions by basePos", () => {
      const pattern = getPattern("bold");
      const decos = findDecorations("**hi**", 10, pattern).map((d) => ({
        from: d.from,
        to: d.to,
      }));
      expect(decos).toEqual([
        { from: 10, to: 12 },
        { from: 12, to: 14 },
        { from: 14, to: 16 },
      ]);
    });
  });
});

describe("CODE_FENCE_REGEX", () => {
  it("matches triple backticks", () => {
    expect(CODE_FENCE_REGEX.test("```")).toBe(true);
  });

  it("matches triple backticks with language", () => {
    expect(CODE_FENCE_REGEX.test("```js")).toBe(true);
  });

  it("matches 4+ backticks", () => {
    expect(CODE_FENCE_REGEX.test("````")).toBe(true);
  });

  it("does not match fewer than 3 backticks", () => {
    expect(CODE_FENCE_REGEX.test("``")).toBe(false);
  });

  it("does not match backticks mid-line", () => {
    expect(CODE_FENCE_REGEX.test("some ``` text")).toBe(false);
  });
});

describe("findCodeBlockDecorations", () => {
  // Helper to create mock paragraph nodes matching the shape
  // findCodeBlockDecorations expects
  function makeParagraphs(lines: string[]) {
    let pos = 0;
    return lines.map((text) => {
      // nodeSize = 1 (open tag) + text length + 1 (close tag)
      const nodeSize = text.length + 2;
      const para = {
        node: {
          textContent: text,
          nodeSize,
          type: { name: "paragraph" },
        },
        pos,
      };
      pos += nodeSize;
      return para;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function decoInfo(d: any) {
    return {
      from: d.from,
      to: d.to,
      class: d.type?.attrs?.class ?? d.type?.spec?.class,
    };
  }

  it("detects a simple fenced code block", () => {
    const paras = makeParagraphs(["```", "hello", "```"]);
    const { decorations, codeBlockRanges } = findCodeBlockDecorations(paras);

    expect(codeBlockRanges).toHaveLength(1);
    // 3 paragraphs: "```" (nodeSize 5) + "hello" (7) + "```" (5) = 17
    expect(codeBlockRanges[0]).toEqual({ from: 0, to: 17 });

    const classes = decorations.map(decoInfo).map((d) => d.class);
    expect(classes).toContain("md-code-block md-code-block-open");
    expect(classes).toContain("md-code-block");
    expect(classes).toContain("md-code-block md-code-block-close");
  });

  it("detects a code block with language specifier", () => {
    const paras = makeParagraphs(["```typescript", "const x = 1;", "```"]);
    const { codeBlockRanges } = findCodeBlockDecorations(paras);
    expect(codeBlockRanges).toHaveLength(1);
  });

  it("dims fence delimiters", () => {
    const paras = makeParagraphs(["```", "code", "```"]);
    const { decorations } = findCodeBlockDecorations(paras);
    const delimiterDecos = decorations.map(decoInfo).filter((d) => d.class === "md-delimiter");
    // Both opening ``` and closing ``` get delimiter decorations
    expect(delimiterDecos).toHaveLength(2);
  });

  it("does not match unclosed fences", () => {
    const paras = makeParagraphs(["```", "code", "no closing"]);
    const { codeBlockRanges } = findCodeBlockDecorations(paras);
    expect(codeBlockRanges).toHaveLength(0);
  });

  it("handles multiple code blocks", () => {
    const paras = makeParagraphs(["```", "a", "```", "text", "```", "b", "```"]);
    const { codeBlockRanges } = findCodeBlockDecorations(paras);
    expect(codeBlockRanges).toHaveLength(2);
  });

  it("requires closing fence to have at least as many backticks as opening", () => {
    const paras = makeParagraphs(["````", "code", "```", "more", "````"]);
    const { codeBlockRanges } = findCodeBlockDecorations(paras);
    // The ``` line is not a valid close for ```` — only ```` closes it
    expect(codeBlockRanges).toHaveLength(1);
    // The block spans from the first ```` to the last ````
    expect(codeBlockRanges[0]).toEqual({
      from: paras[0].pos,
      to: paras[4].pos + paras[4].node.nodeSize,
    });
  });

  it("returns empty for no code blocks", () => {
    const paras = makeParagraphs(["hello", "world"]);
    const { decorations, codeBlockRanges } = findCodeBlockDecorations(paras);
    expect(codeBlockRanges).toHaveLength(0);
    expect(decorations).toHaveLength(0);
  });

  it("produces syntax highlighting decorations for inner lines", () => {
    const paras = makeParagraphs(["```js", "const x = 1;", "```"]);
    const { decorations } = findCodeBlockDecorations(paras);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classes = decorations.map((d: any) => d.type?.attrs?.class ?? d.type?.spec?.class).filter(Boolean);
    // Should have sh- prefixed syntax highlight classes
    expect(classes.some((c: string) => c.startsWith("sh-"))).toBe(true);
    expect(classes).toContain("sh-keyword"); // "const" is a keyword
  });
});

describe("highlightLine", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function decoInfo(d: any) {
    return {
      from: d.from,
      to: d.to,
      class: d.type?.attrs?.class,
    };
  }

  it("highlights JavaScript keywords", () => {
    const decos = highlightLine("const x = 1;", 0, "js").map(decoInfo);
    expect(decos[0]).toEqual({ from: 0, to: 5, class: "sh-keyword" });
  });

  it("highlights strings", () => {
    const decos = highlightLine('"hello"', 0, "js").map(decoInfo);
    const stringDecos = decos.filter((d) => d.class === "sh-string");
    expect(stringDecos.length).toBeGreaterThan(0);
  });

  it("highlights comments", () => {
    const decos = highlightLine("// a comment", 0, "js").map(decoInfo);
    expect(decos[0]?.class).toBe("sh-comment");
  });

  it("respects basePos offset", () => {
    const decos = highlightLine("const x", 100, "js").map(decoInfo);
    expect(decos[0]).toEqual({ from: 100, to: 105, class: "sh-keyword" });
  });

  it("returns empty for empty text", () => {
    expect(highlightLine("", 0, "js")).toHaveLength(0);
  });

  it("works without a language specifier", () => {
    const decos = highlightLine("const x = 1;", 0, undefined);
    expect(decos.length).toBeGreaterThan(0);
  });
});

describe("getLanguageOptions", () => {
  it("returns a preset for known languages", () => {
    expect(getLanguageOptions("python")).toBeDefined();
    expect(getLanguageOptions("py")).toBeDefined();
    expect(getLanguageOptions("rust")).toBeDefined();
    expect(getLanguageOptions("go")).toBeDefined();
    expect(getLanguageOptions("css")).toBeDefined();
    expect(getLanguageOptions("java")).toBeDefined();
    expect(getLanguageOptions("c")).toBeDefined();
  });

  it("is case-insensitive", () => {
    expect(getLanguageOptions("Python")).toBeDefined();
    expect(getLanguageOptions("RUST")).toBeDefined();
  });

  it("returns undefined for unknown languages", () => {
    expect(getLanguageOptions("brainfuck")).toBeUndefined();
  });

  it("returns undefined for no language", () => {
    expect(getLanguageOptions(undefined)).toBeUndefined();
  });
});
