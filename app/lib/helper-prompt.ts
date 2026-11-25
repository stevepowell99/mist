import { validHelperOps, type HelperOp } from "./helper-edits";

/**
 * What the helper sends the model, and how its reply is read back.
 *
 * The whole document goes every turn, never an excerpt: an edit is anchored by
 * exact text, and the model can only copy text it has been shown. The
 * conversation goes as the last `HISTORY_TURNS` messages, which the panel says.
 */
export interface HelperMessage {
  role: "user" | "assistant";
  text: string;
}

export interface HelperRequest {
  name: string;
  document: string;
  /** The selected text, when there is a selection: what "this" refers to. */
  selection?: string;
  mode: "edit" | "suggest";
  history: HelperMessage[];
  message: string;
}

/** How many earlier messages go with each turn. */
export const HISTORY_TURNS = 20;

/** Past this the request is refused rather than cut: a model shown part of a
 *  document cannot anchor edits in the rest, and would not say so. */
export const MAX_DOCUMENT_CHARS = 600_000;

export const HELPER_SYSTEM = `You are the writing helper inside gmist, a markdown editor. The person talking to you is writing the document you are shown, and you can change it directly.

Answer with ONLY a JSON object, no code fence and no text around it, with two fields:
- "reply": your answer to them, in markdown, brief. Say what you changed and why, or answer the question. If you changed nothing, say so.
- "edits": an array of changes to the document, empty when none is wanted.

Each edit locates its passage with "find", an exact substring of the document as you were shown it, copied character for character (spaces, punctuation, markdown marks and line breaks included). Make each "find" long enough to occur exactly once in the document, and no longer than it needs to be. The kinds of edit:
- {"op":"replace","find":...,"replace":...} rewrites a passage; to rewrite a paragraph, find the whole paragraph and give its new text
- {"op":"insertAfter","find":...,"text":...} and {"op":"insertBefore","find":...,"text":...} add text beside a passage; include any line breaks the new text needs
- {"op":"delete","find":...} removes a passage
- {"op":"comment","find":...,"text":...} leaves a review comment on a passage, and with no "find" at the end of the document

Rules:
- Change only what you were asked to change. Leave everything else exactly as it is, including the frontmatter between the leading --- lines, unless asked.
- Keep the document's own markdown conventions, language and spelling. gmist documents and slide decks use markdown, fenced divs (::: {.class}), CriticMarkup ({++added++}, {--deleted--}, {>>comment<<}, {==highlight==}) and citations ([@key]); keep these intact.
- Write plain replacement text. Never write CriticMarkup additions or deletions yourself: in Suggesting mode the editor turns your edits into tracked changes.
- Never invent facts, figures, quotations, citations or references. If a request needs facts the document does not contain, say so in "reply" and leave a comment instead of making them up.
- When text is selected, "this", "here" and "it" mean the selection.
- If the request is unclear, ask in "reply" and make no edits.`;

/** The turn's user prompt: the conversation so far, the document, the ask. */
export function helperPrompt(req: HelperRequest): string {
  const history = req.history.slice(-HISTORY_TURNS);
  const parts: string[] = [];
  if (history.length) {
    parts.push(
      "<conversation>\n" +
        history.map((m) => `<${m.role}>\n${m.text}\n</${m.role}>`).join("\n") +
        "\n</conversation>",
    );
  }
  parts.push(`<document name="${req.name.replace(/"/g, "'")}">\n${req.document}\n</document>`);
  if (req.selection) parts.push(`<selection>\n${req.selection}\n</selection>`);
  parts.push(
    `The editor is in ${req.mode === "suggest" ? "Suggesting mode: your edits will appear as tracked changes for them to accept or reject" : "Editing mode: your edits change the text directly"}.`,
  );
  parts.push(`<request>\n${req.message}\n</request>`);
  return parts.join("\n\n");
}

export interface HelperReply {
  reply: string;
  edits: HelperOp[];
  /** Edits in the reply that were not one of the five shapes. */
  rejected: number;
  /** The reply was not the JSON asked for, so it is shown as text alone. */
  unparsed: boolean;
}

/**
 * Read the model's reply. It is asked for bare JSON; anything around the
 * object (a fence, a sentence) is tolerated by taking the outermost braces.
 * A reply with no usable JSON is shown as it is, with no edits, and says so.
 */
export function parseHelperReply(raw: string): HelperReply {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(raw.slice(start, end + 1)) as { reply?: unknown; edits?: unknown };
      if (data && typeof data === "object" && (typeof data.reply === "string" || Array.isArray(data.edits))) {
        const { ops, rejected } = validHelperOps(data.edits);
        return { reply: typeof data.reply === "string" ? data.reply : "", edits: ops, rejected, unparsed: false };
      }
    } catch {
      // fall through: shown as text
    }
  }
  return { reply: raw.trim(), edits: [], rejected: 0, unparsed: true };
}
