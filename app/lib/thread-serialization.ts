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
  // The editor text carries no frontmatter; the doc-level frontmatter is the
  // reliable source, but honour any the markdown happens to include too.
  const existing = { ...parseYaml(baseFrontmatter), ...parseFrontmatter(markdown) };
  const body = stripFrontmatter(markdown);

  if (threads.length === 0) {
    return Object.keys(existing).length === 0
      ? body
      : `---\n${stringify(existing, { lineWidth: 0 })}---\n\n${body}`;
  }

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
  const body = stripFrontmatter(markdown);
  const fm = parseFrontmatter(markdown);

  // Everything except mist (threads/onboarding are handled separately) is the
  // file's own config that must survive the round-trip.
  const { mist: mistKey, ...rest } = fm;
  const frontmatter =
    Object.keys(rest).length > 0 ? stringify(rest, { lineWidth: 0 }) : "";
  void mistKey;

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
