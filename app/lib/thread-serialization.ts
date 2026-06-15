import { stringify, parse } from "yaml";
import type { ThreadData } from "~/shared/types";

const FRONTMATTER_RE = /^---\n([\s\S]*?\n)---\n\n?/;

/** Parse a bare YAML string (no `---` fences) to an object, tolerating errors. */
function parseYaml(yamlStr: string): Record<string, unknown> {
  try {
    const result = parse(yamlStr);
    return result && typeof result === "object" ? result : {};
  } catch {
    return {};
  }
}

export function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(markdown);
  return match ? parseYaml(match[1]) : {};
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "");
}

/** The exact inner YAML text of the frontmatter (between the --- fences), or "". */
export function rawFrontmatter(markdown: string): string {
  const m = FRONTMATTER_RE.exec(markdown);
  return m ? m[1] : "";
}

/**
 * The document with only the internal `mist:` threads block removed from its
 * frontmatter, leaving the user's YAML (title/format/css...) in place so it is
 * shown and edited in the editor. Byte-exact when there is no mist block to
 * remove (the common case); only a mist-bearing file is reconstructed.
 */
function stripMistFromDoc(markdown: string): string {
  const raw = rawFrontmatter(markdown);
  if (!raw || !/^mist\s*:/m.test(raw)) return markdown;
  const cleaned = stripMistKey(raw);
  const body = stripFrontmatter(markdown);
  if (!cleaned.trim()) return body;
  const fmText = cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`;
  return `---\n${fmText}---\n\n${body}`;
}

/** Remove a top-level `mist:` block from raw frontmatter text, leaving the rest
 *  verbatim. mist threads are managed separately; everything else round-trips
 *  unchanged (no quote-stripping or reordering). */
function stripMistKey(raw: string): string {
  const cleaned = raw.replace(/^mist:[^\n]*\n(?:[ \t]+[^\n]*\n?)*/m, "");
  return cleaned.trim() === "" ? "" : cleaned;
}

interface SerializedThread {
  comment: string;
  highlight?: string;
  author: string;
  color: string;
  created: string;
  resolved: boolean;
  replies?: {
    author: string;
    color: string;
    text: string;
    created: string;
  }[];
}

/**
 * Serialize the document back to a markdown file. `baseFrontmatter` is the
 * document's own YAML frontmatter (theme, css, format, title...), carried
 * separately from the editor text because the editor holds body only. It is
 * re-emitted here so a commit-back or download keeps the deck/file config.
 * The comment threads are folded into a `mist:` key on top of it.
 */
export function serializeThreads(
  markdown: string,
  threads: ThreadData[],
  baseFrontmatter = "",
): string {
  const body = stripFrontmatter(markdown);
  // The editor text now carries its own frontmatter; prefer it so edits to the
  // YAML are saved. baseFrontmatter is a fallback for callers that still pass
  // body-only markdown. Keeping the raw text verbatim means quotes and key order
  // survive a commit-back.
  const ownRaw = rawFrontmatter(markdown);
  const raw = ownRaw || baseFrontmatter;

  if (threads.length === 0) {
    // Frontmatter already in the text: return it untouched, byte-faithful.
    if (ownRaw) return markdown;
    if (!raw.trim()) return body;
    const fmText = raw.endsWith("\n") ? raw : `${raw}\n`;
    return `---\n${fmText}---\n\n${body}`;
  }

  // Comment threads need a `mist:` key, so this path parses and re-emits (which
  // may reformat). It only runs when the doc actually has comments.
  const existing = { ...parseYaml(raw) };

  const serialized: SerializedThread[] = threads.map((t) => {
    const entry: SerializedThread = {
      comment: t.commentText,
      author: t.author.name,
      color: t.author.color,
      created: new Date(t.createdAt).toISOString(),
      resolved: t.resolved,
    };
    if (t.highlightText) {
      entry.highlight = t.highlightText;
    }
    if (t.replies.length > 0) {
      entry.replies = t.replies.map((r) => ({
        author: r.author.name,
        color: r.author.color,
        text: r.text,
        created: new Date(r.createdAt).toISOString(),
      }));
    }
    return entry;
  });

  const fm: Record<string, unknown> = { ...existing };
  const existingMist =
    fm.mist && typeof fm.mist === "object"
      ? (fm.mist as Record<string, unknown>)
      : {};
  fm.mist = { ...existingMist, threads: serialized };

  const yamlStr = stringify(fm, { lineWidth: 0 });
  return `---\n${yamlStr}---\n\n${body}`;
}

export function deserializeThreads(markdown: string): {
  body: string;
  threads: ThreadData[];
  onboarding: boolean;
  /** The file's own frontmatter as YAML (the `mist` key removed), "" if none.
   *  Carried into the doc so theme/css/format round-trip on commit-back. */
  frontmatter: string;
} {
  // The editor shows the user's frontmatter, so keep it in the body. Only the
  // internal mist threads block is removed. The body is byte-exact unless a mist
  // block had to be stripped.
  const body = stripMistFromDoc(markdown);
  const fm = parseFrontmatter(markdown);

  // Still surfaced (raw, mist removed) for callers that read it directly.
  const frontmatter = stripMistKey(rawFrontmatter(markdown));

  const mist = fm.mist as Record<string, unknown> | undefined;
  const onboarding = mist?.onboarding === true;
  if (!mist || !Array.isArray(mist.threads)) {
    return { body, threads: [], onboarding, frontmatter };
  }

  const threads: ThreadData[] = mist.threads.map(
    (raw: SerializedThread, i: number) => ({
      id: `imported-${i}`,
      commentText: raw.comment ?? "",
      highlightText: raw.highlight,
      author: {
        name: raw.author ?? "Unknown",
        color: raw.color ?? "#999",
        colorLight: raw.color ?? "#999",
      },
      createdAt: raw.created ? new Date(raw.created).getTime() : Date.now(),
      resolved: raw.resolved ?? false,
      replies: (raw.replies ?? []).map(
        (r: { author: string; color: string; text: string; created: string }, j: number) => ({
          id: `imported-${i}-r${j}`,
          author: {
            name: r.author ?? "Unknown",
            color: r.color ?? "#999",
            colorLight: r.color ?? "#999",
          },
          text: r.text ?? "",
          createdAt: r.created ? new Date(r.created).getTime() : Date.now(),
        }),
      ),
    }),
  );

  return { body, threads, onboarding, frontmatter };
}
