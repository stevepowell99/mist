import { stripCritic } from "./critic";
import { stripFrontmatter } from "./thread-serialization";

/**
 * Word and character counts of markdown as a reader would count them: what is
 * left once the source is reduced to its visible text. Frontmatter, HTML
 * comments, CriticMarkup comments and deletions (suggestions are taken as
 * accepted), images, link targets, Pandoc attributes, fenced-div fences, HTML
 * tags and the markdown marks themselves are left out. A word is a
 * whitespace-separated run holding a letter or a digit, as Word and Google Docs
 * count; characters include the spaces between words but not line breaks.
 */
export function countText(md: string): { words: number; chars: number } {
  let words = 0;
  let chars = 0;
  for (const line of plainText(md).split("\n")) {
    const t = line.replace(/\s+/g, " ").trim();
    if (!t) continue;
    chars += [...t].length;
    for (const tok of t.split(" ")) if (/[\p{L}\p{N}]/u.test(tok)) words++;
  }
  return { words, chars };
}

/** The visible text of a markdown source, line by line. */
function plainText(md: string): string {
  return stripCritic(stripFrontmatter(md))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^ {0,3}:{3,}.*$/gm, "")
    .replace(/\{[.#][^}\n]*\}/g, "")
    .replace(/!\[\[[^\]\n]*\]\]/g, "")
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, "")
    .replace(/\[\[(?:[^\]|\n]*\|)?([^\]\n]*)\]\]/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, "")
    .replace(/^ *\|? *:?-{3,}:? *(\| *:?-{3,}:? *)*\|? *$/gm, "")
    .replace(/^ {0,3}([-*_] *){3,}$/gm, "")
    .replace(/^ {0,3}#{1,6}(?= |$)/gm, "")
    .replace(/^ *(> *)+/gm, "")
    .replace(/^ *([-*+]|\d+[.)]) +(\[[ xX]\] +)?/gm, "")
    .replace(/\[\^[^\]\n]*\]:?/g, "")
    .replace(/\*+|`+|==/g, "")
    .replace(/\|/g, " ");
}
