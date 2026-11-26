import { describe, it, expect } from "vitest";
import { HISTORY_TURNS, helperPrompt, parseHelperReply } from "~/lib/helper-prompt";

describe("parseHelperReply", () => {
  it("reads the JSON it asked for", () => {
    const r = parseHelperReply('{"reply":"Tightened it.","edits":[{"op":"replace","find":"a b","replace":"a"}]}');
    expect(r).toEqual({ reply: "Tightened it.", edits: [{ op: "replace", find: "a b", replace: "a" }], rejected: 0, unparsed: false });
  });

  it("tolerates a fence or a sentence around the object", () => {
    const r = parseHelperReply('Here you are:\n```json\n{"reply":"ok","edits":[]}\n```');
    expect(r.unparsed).toBe(false);
    expect(r.reply).toBe("ok");
  });

  it("shows a reply that is not JSON as text, with no edits", () => {
    const r = parseHelperReply("I could not do that.");
    expect(r).toEqual({ reply: "I could not do that.", edits: [], rejected: 0, unparsed: true });
  });

  it("counts edits that are not usable", () => {
    expect(parseHelperReply('{"reply":"x","edits":[{"op":"replace","find":"a"}]}').rejected).toBe(1);
  });

  it("drops every edit from an ask turn, whatever the model returned", () => {
    const raw = '{"reply":"It argues X.","edits":[{"op":"replace","find":"a b","replace":"a"},{"op":"comment","text":"n"}]}';
    expect(parseHelperReply(raw, "ask")).toEqual({ reply: "It argues X.", edits: [], rejected: 0, unparsed: false });
  });
});

describe("helperPrompt", () => {
  const base = {
    name: "notes.md",
    document: "# Title\n\nBody.",
    mode: "edit" as const,
    intent: "change" as const,
    history: [],
    message: "Tighten it",
  };

  it("sends the whole document, the selection and the request", () => {
    const p = helperPrompt({ ...base, selection: "Body." });
    expect(p).toContain("# Title\n\nBody.");
    expect(p).toContain("<selection>\nBody.\n</selection>");
    expect(p).toContain("<request>\nTighten it\n</request>");
  });

  it("says which mode the editor is in", () => {
    expect(helperPrompt({ ...base, mode: "suggest" })).toContain("Suggesting mode");
  });

  it("asks for no edits on an ask turn, and drops the editor mode", () => {
    const p = helperPrompt({ ...base, mode: "suggest", intent: "ask" });
    expect(p).toContain("answer only");
    expect(p).not.toContain("Suggesting mode");
  });

  it("sends only the last HISTORY_TURNS messages", () => {
    const history = Array.from({ length: HISTORY_TURNS + 5 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const p = helperPrompt({ ...base, history });
    expect(p).not.toContain("<user>\nm4\n</user>");
    expect(p).toContain(`<user>\nm${HISTORY_TURNS + 4}\n</user>`);
  });
});
