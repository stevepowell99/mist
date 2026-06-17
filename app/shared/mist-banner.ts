// A banner injected into the committed file so anyone opening the note in
// Obsidian sees that it is live on mist (and should not be edited locally).
// It is wrapped in HTML-comment sentinels so mist (and the Garden build) can
// strip it again, keeping it out of the mist web view and the published site.

const START = "<!-- mist:banner:start -->";
const END = "<!-- mist:banner:end -->";

const BANNER_BODY =
  "> [!warning] Open for collaborative review on gmist\n" +
  "> This note is being edited on gmist. Avoid editing it here in Obsidian until the review is finished, or your local changes may be overwritten.";

/** Remove a previously injected mist banner block, wherever it sits. */
export function stripMistBanner(md: string): string {
  const re = new RegExp(`${START}[\\s\\S]*?${END}\\n*`, "g");
  return md.replace(re, "");
}

/** Inject the banner just after any YAML frontmatter (so frontmatter stays first). */
export function withMistBanner(md: string): string {
  const clean = stripMistBanner(md);
  const block = `${START}\n${BANNER_BODY}\n${END}\n\n`;
  const fm = clean.match(/^---\n[\s\S]*?\n---\n/);
  if (fm) return fm[0] + block + clean.slice(fm[0].length);
  return block + clean;
}
