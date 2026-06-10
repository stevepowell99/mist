import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { tokenize, SugarHigh } from "sugar-high";
import * as presets from "sugar-high/presets";

export type PatternType = "inline" | "prefix" | "heading" | "link";

export interface MarkdownPattern {
  name: string;
  regex: RegExp;
  type: PatternType;
  contentClass: string;
  delimiterClass: string;
}

export const MARKDOWN_PATTERNS: MarkdownPattern[] = [
  {
    name: "bold",
    regex: /\*\*(.+?)\*\*/g,
    type: "inline",
    contentClass: "md-bold",
    delimiterClass: "md-delimiter",
  },
  {
    name: "italic",
    regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    type: "inline",
    contentClass: "md-italic",
    delimiterClass: "md-delimiter",
  },
  {
    name: "italic-underscore",
    regex: /(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g,
    type: "inline",
    contentClass: "md-italic",
    delimiterClass: "md-delimiter",
  },
  {
    name: "code",
    regex: /`([^`]+)`/g,
    type: "inline",
    contentClass: "md-code",
    delimiterClass: "md-delimiter",
  },
  {
    name: "strikethrough",
    regex: /~~(.+?)~~/g,
    type: "inline",
    contentClass: "md-strikethrough",
    delimiterClass: "md-delimiter",
  },
  {
    name: "heading",
    regex: /^(#{1,6}\s)(.+)$/gm,
    type: "heading",
    contentClass: "md-heading",
    delimiterClass: "md-heading-delimiter",
  },
  {
    name: "link",
    regex: /\[([^\]]+)\]\(([^)]+)\)/g,
    type: "link",
    contentClass: "md-link-text",
    delimiterClass: "md-delimiter",
  },
  {
    name: "blockquote",
    regex: /^(>\s)/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-delimiter",
  },
  {
    name: "list",
    regex: /^(\s*(?:[-*+]|\d+\.)\s)/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-delimiter",
  },
  {
    name: "hr",
    regex: /^([-*_]{3,})\s*$/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-hr",
  },
];

export const CODE_FENCE_REGEX = /^(`{3,})(.*)?$/;

export const TABLE_ROW_REGEX = /^\s*\|.*\|\s*$/;

const TOKEN_TYPE_NAMES = SugarHigh.TokenTypes as unknown as string[];

// Token types that get no special colour — skip them to avoid unnecessary DOM nodes
const SKIP_TOKEN_TYPES = new Set(["identifier", "break", "space"]);

const LANGUAGE_PRESETS: Record<string, typeof presets.css | undefined> = {
  css: presets.css,
  rust: presets.rust,
  rs: presets.rust,
  python: presets.python,
  py: presets.python,
  c: presets.c,
  cpp: presets.c,
  "c++": presets.c,
  h: presets.c,
  go: presets.go,
  golang: presets.go,
  java: presets.java,
};

export function getLanguageOptions(lang: string | undefined) {
  if (!lang) return undefined;
  return LANGUAGE_PRESETS[lang.toLowerCase()];
}

export function highlightLine(
  text: string,
  basePos: number,
  lang: string | undefined,
): Decoration[] {
  if (text.length === 0) return [];

  const options = getLanguageOptions(lang);
  const tokens = tokenize(text, options ?? undefined);
  const decorations: Decoration[] = [];
  let offset = 0;

  for (const [typeIndex, tokenText] of tokens) {
    const typeName = TOKEN_TYPE_NAMES[typeIndex];
    const len = tokenText.length;
    if (!SKIP_TOKEN_TYPES.has(typeName) && len > 0) {
      decorations.push(
        Decoration.inline(basePos + offset, basePos + offset + len, {
          class: `sh-${typeName}`,
        }),
      );
    }
    offset += len;
  }

  return decorations;
}

interface ParagraphInfo {
  node: Parameters<Parameters<typeof import("@tiptap/pm/model").Node.prototype.descendants>[0]>[0];
  pos: number;
}

export function findCodeBlockDecorations(
  paragraphs: ParagraphInfo[],
): { decorations: Decoration[]; codeBlockRanges: Array<{ from: number; to: number }> } {
  const decorations: Decoration[] = [];
  const codeBlockRanges: Array<{ from: number; to: number }> = [];
  let i = 0;

  while (i < paragraphs.length) {
    const { node: openNode, pos: openPos } = paragraphs[i];
    const openText = openNode.textContent;
    const openMatch = CODE_FENCE_REGEX.exec(openText);

    if (!openMatch) {
      i++;
      continue;
    }

    const fenceChar = openMatch[1];
    const fenceLen = fenceChar.length;

    // Search for closing fence
    let j = i + 1;
    let closedAt = -1;
    while (j < paragraphs.length) {
      const closeText = paragraphs[j].node.textContent;
      const closeMatch = CODE_FENCE_REGEX.exec(closeText);
      if (closeMatch && closeMatch[1].length >= fenceLen && !closeMatch[2]?.trim()) {
        closedAt = j;
        break;
      }
      j++;
    }

    if (closedAt === -1) {
      // No closing fence — not a code block
      i++;
      continue;
    }

    // Track the range from opening fence node start to closing fence node end
    const blockFrom = openPos;
    const closePara = paragraphs[closedAt];
    const blockTo = closePara.pos + closePara.node.nodeSize;
    codeBlockRanges.push({ from: blockFrom, to: blockTo });

    // Opening fence: node decoration + inline delimiter
    decorations.push(
      Decoration.node(openPos, openPos + openNode.nodeSize, {
        class: "md-code-block md-code-block-open",
      }),
    );
    if (openNode.textContent.length > 0) {
      decorations.push(
        Decoration.inline(openPos + 1, openPos + 1 + openNode.textContent.length, {
          class: "md-delimiter",
        }),
      );
    }

    // Extract language from fence info string (e.g. "```js" → "js")
    const lang = openMatch[2]?.trim() || undefined;

    // Inner lines: node decoration for background + monospace, plus syntax highlighting
    for (let k = i + 1; k < closedAt; k++) {
      const { node: innerNode, pos: innerPos } = paragraphs[k];
      decorations.push(
        Decoration.node(innerPos, innerPos + innerNode.nodeSize, {
          class: "md-code-block",
        }),
      );
      // Syntax highlight the text content (pos + 1 to skip paragraph open token)
      const innerText = innerNode.textContent;
      if (innerText.length > 0) {
        decorations.push(...highlightLine(innerText, innerPos + 1, lang));
      }
    }

    // Closing fence: node decoration + inline delimiter
    decorations.push(
      Decoration.node(closePara.pos, closePara.pos + closePara.node.nodeSize, {
        class: "md-code-block md-code-block-close",
      }),
    );
    if (closePara.node.textContent.length > 0) {
      decorations.push(
        Decoration.inline(closePara.pos + 1, closePara.pos + 1 + closePara.node.textContent.length, {
          class: "md-delimiter",
        }),
      );
    }

    i = closedAt + 1;
  }

  return { decorations, codeBlockRanges };
}

function posInsideCodeBlock(
  pos: number,
  nodeSize: number,
  codeBlockRanges: Array<{ from: number; to: number }>,
): boolean {
  for (const range of codeBlockRanges) {
    if (pos >= range.from && pos + nodeSize <= range.to) return true;
  }
  return false;
}

export function findDecorations(
  text: string,
  basePos: number,
  pattern: MarkdownPattern,
): Decoration[] {
  const decorations: Decoration[] = [];
  pattern.regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.regex.exec(text)) !== null) {
    const fullStart = basePos + match.index;
    const fullEnd = fullStart + match[0].length;

    if (pattern.type === "prefix") {
      decorations.push(
        Decoration.inline(fullStart, fullEnd, {
          class: pattern.delimiterClass,
        }),
      );
    } else if (pattern.type === "heading") {
      // match[1] = "## ", match[2] = heading text
      const delimEnd = fullStart + match[1].length;
      const level = match[1].trim().length; // number of # characters
      decorations.push(
        Decoration.inline(fullStart, delimEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(delimEnd, fullEnd, {
          class: `${pattern.contentClass} md-heading-${level}`,
        }),
      );
    } else if (pattern.type === "link") {
      // Full match: [text](url)
      // match[1] = link text, match[2] = url
      const textContent = match[1];
      const urlContent = match[2];
      // [ delimiter
      const bracketStart = fullStart;
      const bracketEnd = bracketStart + 1;
      // link text
      const textStart = bracketEnd;
      const textEnd = textStart + textContent.length;
      // ]( delimiter
      const midStart = textEnd;
      const midEnd = midStart + 2;
      // url
      const urlStart = midEnd;
      const urlEnd = urlStart + urlContent.length;
      // ) delimiter
      const closeStart = urlEnd;
      const closeEnd = closeStart + 1;

      decorations.push(
        Decoration.inline(bracketStart, bracketEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(textStart, textEnd, {
          class: pattern.contentClass,
        }),
      );
      decorations.push(
        Decoration.inline(midStart, midEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(urlStart, urlEnd, {
          class: "md-link-url",
          nodeName: "a",
          href: urlContent,
          target: "_blank",
          rel: "noopener noreferrer",
        }),
      );
      decorations.push(
        Decoration.inline(closeStart, closeEnd, {
          class: pattern.delimiterClass,
        }),
      );
    } else {
      // inline: [delimiter][content][delimiter]
      const contentStart = fullStart + match[0].indexOf(match[1]);
      const contentEnd = contentStart + match[1].length;

      decorations.push(
        Decoration.inline(fullStart, contentStart, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(contentStart, contentEnd, {
          class: pattern.contentClass,
        }),
      );
      decorations.push(
        Decoration.inline(contentEnd, fullEnd, {
          class: pattern.delimiterClass,
        }),
      );
    }
  }

  return decorations;
}

export const cleanViewKey = new PluginKey<boolean>("cleanView");

const markdownPluginKey = new PluginKey("markdownDecorations");

// Image syntax in editor text: markdown ![alt](url) and HTML <img src="url">
const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const INLINE_HTML_IMAGE_RE = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;

/** Resolve an image URL for inline display, or null to skip rendering. */
export type ImageResolver = (url: string) => string | null;

export function markdownDecorations(resolveImageSrc: ImageResolver | null = null): Plugin[] {
  const cleanViewPlugin = new Plugin<boolean>({
    key: cleanViewKey,
    state: {
      init() {
        return false;
      },
      apply(tr, value) {
        const meta = tr.getMeta(cleanViewKey);
        if (meta !== undefined) return meta as boolean;
        return value;
      },
    },
  });

  const decorationPlugin = new Plugin({
    key: markdownPluginKey,
    props: {
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement;
        const anchor = target.closest("a.md-link-url");
        if (anchor) {
          const href = anchor.getAttribute("href");
          if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      decorations(state) {
        const decorations: Decoration[] = [];

        // First pass: collect paragraphs and find code blocks
        const paragraphs: ParagraphInfo[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === "paragraph") {
            paragraphs.push({ node, pos });
          }
        });

        const { decorations: codeBlockDecos, codeBlockRanges } =
          findCodeBlockDecorations(paragraphs);
        decorations.push(...codeBlockDecos);

        // Table rows: monospace so pipe columns align in the source view
        for (const { node, pos } of paragraphs) {
          if (!TABLE_ROW_REGEX.test(node.textContent)) continue;
          if (posInsideCodeBlock(pos, node.nodeSize, codeBlockRanges)) continue;
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, { class: "md-table-row" }),
          );
        }

        // Second pass: inline patterns, skipping nodes inside code blocks
        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          if (posInsideCodeBlock(pos, node.nodeSize, codeBlockRanges)) return;
          for (const pattern of MARKDOWN_PATTERNS) {
            decorations.push(...findDecorations(node.text, pos, pattern));
          }

          // Inline image preview: render the picture below its source line so
          // it can be seen (and its source text commented on) while editing.
          // Handles both markdown ![alt](url) and HTML <img src="url">.
          if (resolveImageSrc) {
            const text = node.text;
            const found: Array<{ raw: string; alt: string; end: number }> = [];
            for (const [re, urlGroup, altGroup] of [
              [INLINE_IMAGE_RE, 2, 1],
              [INLINE_HTML_IMAGE_RE, 1, 0],
            ] as const) {
              re.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text)) !== null) {
                found.push({ raw: m[urlGroup], alt: altGroup ? m[altGroup] : "", end: pos + m.index + m[0].length });
              }
            }
            for (const { raw, alt, end } of found) {
              const src = resolveImageSrc(raw);
              if (!src) continue;
              decorations.push(
                Decoration.widget(
                  end,
                  () => {
                    const img = document.createElement("img");
                    img.src = src;
                    img.alt = alt;
                    img.className = "md-inline-image";
                    return img;
                  },
                  { side: 1, key: `img:${end}:${src}` },
                ),
              );
            }
          }
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });

  return [cleanViewPlugin, decorationPlugin];
}
