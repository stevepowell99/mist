// Pandoc-style citation rendering for Preview, mirroring the Garden build's APA
// output (build_static_site.py). Sources a BibTeX library, converts `[@key]`
// citations to inline APA text, and renders an APA reference list of used keys.

export interface BibEntry {
  authors: string[]; // family names only
  year: string;
  title?: string;
  journal?: string;
  volume?: string;
  pages?: string;
  booktitle?: string;
  publisher?: string;
  doi?: string;
  url?: string;
}

export type BibLibrary = Map<string, BibEntry>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Extract a BibTeX field, handling nested braces or quotes, stripping LaTeX braces. */
function extractField(body: string, name: string): string | undefined {
  const open = new RegExp(`${name}\\s*=\\s*\\{`, "i").exec(body);
  if (open) {
    let depth = 1;
    let i = open.index + open[0].length;
    const start = i;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
    }
    if (depth === 0) {
      let v = body.slice(start, i - 1);
      v = v.replace(/\{\{([^}]+)\}\}/g, "$1").replace(/\{(\w+)\}/g, "$1").replace(/[{}]/g, "");
      return v.trim();
    }
  }
  const q = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(body);
  return q ? q[1].trim() : undefined;
}

function familyNames(authorRaw: string): string[] {
  const fams: string[] = [];
  for (const a of authorRaw.split(" and ").map((s) => s.trim()).filter(Boolean)) {
    const fam = a.includes(",") ? a.split(",")[0].trim() : (a.split(/\s+/).pop() ?? a);
    if (fam) fams.push(fam);
  }
  return fams;
}

export function parseBib(text: string): BibLibrary {
  const lib: BibLibrary = new Map();
  for (let raw of text.split(/\n@/)) {
    if (!raw.trim()) continue;
    if (!raw.startsWith("@")) raw = "@" + raw;
    const header = /^@\w+\s*\{\s*([^,\s]+)\s*,/.exec(raw);
    if (!header) continue;
    const key = header[1].trim();
    const body = raw.slice(header[0].length);
    let year = extractField(body, "year") ?? "";
    if (!year) year = (extractField(body, "date") ?? "").split("-")[0];
    lib.set(key, {
      authors: familyNames(extractField(body, "author") ?? ""),
      year: year || "n.d.",
      title: extractField(body, "title"),
      journal: extractField(body, "journal"),
      volume: extractField(body, "volume"),
      pages: extractField(body, "pages"),
      booktitle: extractField(body, "booktitle"),
      publisher: extractField(body, "publisher"),
      doi: extractField(body, "doi"),
      url: extractField(body, "url"),
    });
  }
  return lib;
}

function hrefFor(e: BibEntry): string | null {
  if (e.doi) {
    const d = e.doi.trim();
    if (/^https?:\/\/doi\.org\//i.test(d)) return d;
    return `https://doi.org/${d.replace(/^doi:/i, "").trim()}`;
  }
  return e.url ? e.url.trim() : null;
}

function authorText(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors[0]} et al.`;
}

// `[@key; -@key2, p.5]` citation groups. The `(?!\()` skips a markdown link
// label, so `[steve@pogol.net](mailto:steve@pogol.net)` is left as a link rather
// than read as a citation (the `@` in an email address would otherwise match).
const BRACKET_RE = /\[([^\]]*@[^\]]+)\](?!\()/g;
const BARE_RE =
  /(?<![\w[])@([A-Za-z0-9:_-]+)\b(?:\s*,\s*((?:pp?\.|chap?\.|sec\.|§)\s*\w+(?:[.-]\w+)*))?/g;

/** Convert `[@key; -@key2, p.5]` and bare `@key` to inline APA, returning used keys. */
export function convertCitations(md: string, lib: BibLibrary): { text: string; usedKeys: Set<string> } {
  const used = new Set<string>();

  let out = md.replace(BRACKET_RE, (whole, inner: string) => {
    const items: string[] = [];
    for (const chunk of inner.split(";")) {
      const km = /@([A-Za-z0-9:_-]+)/.exec(chunk);
      if (!km) continue;
      const key = km[1];
      const locator = chunk.slice(km.index + km[0].length).replace(/^[\s,]+|[\s,]+$/g, "");
      let prefix = chunk.slice(0, km.index).replace(/\s+$/, "");
      const suppress = prefix.endsWith("-");
      if (suppress) prefix = prefix.slice(0, -1).replace(/\s+$/, "");
      prefix = prefix.trim();

      const e = lib.get(key);
      if (e) used.add(key);
      const authors = e?.authors ?? [];
      const year = e?.year ?? "n.d.";
      const base = suppress
        ? (locator ? `${year}, ${locator}` : year)
        : (() => {
            const a = authorText(authors);
            const b = a ? `${a} ${year}` : year;
            return locator ? `${b}, ${locator}` : b;
          })();
      const href = e ? hrefFor(e) : null;
      const cite = href ? `[${base}](${href})` : base;
      items.push(prefix ? `${prefix} ${cite}` : cite);
    }
    return items.length ? `(${items.join("; ")})` : whole;
  });

  out = out.replace(BARE_RE, (_whole, key: string, locator?: string) => {
    const e = lib.get(key);
    if (e) used.add(key);
    const authors = e?.authors ?? [];
    const year = e?.year ?? "n.d.";
    const loc = (locator ?? "").trim();
    const a = authorText(authors);
    const base = a ? `${a} (${loc ? `${year}, ${loc}` : year})` : `(${loc ? `${year}, ${loc}` : year})`;
    const href = e ? hrefFor(e) : null;
    return href ? `[${base}](${href})` : base;
  });

  return { text: out, usedKeys: used };
}

/** APA reference list HTML for the cited keys, sorted by first author then year. */
export function formatReferenceList(usedKeys: Set<string>, lib: BibLibrary): string {
  if (usedKeys.size === 0) return "";
  const keys = [...usedKeys].filter((k) => lib.has(k));
  keys.sort((a, b) => {
    const ea = lib.get(a)!;
    const eb = lib.get(b)!;
    const fa = (ea.authors[0] ?? "").toLowerCase();
    const fb = (eb.authors[0] ?? "").toLowerCase();
    return fa === fb ? ea.year.localeCompare(eb.year) : fa.localeCompare(fb);
  });

  const items = keys.map((key) => {
    const e = lib.get(key)!;
    const a = e.authors;
    let authorStr = "";
    if (a.length === 1) authorStr = a[0];
    else if (a.length > 1 && a.length <= 20) authorStr = `${a.slice(0, -1).join(", ")}, & ${a[a.length - 1]}`;
    else if (a.length > 20) authorStr = `${a.slice(0, 19).join(", ")}, ... ${a[a.length - 1]}`;

    let html = `<p class="reference">`;
    html += authorStr ? `${escapeHtml(authorStr)} (${escapeHtml(e.year)}). ` : `(${escapeHtml(e.year)}). `;
    html += `<em>${escapeHtml(e.title ?? `[${key}]`)}</em>`;
    if (e.journal) {
      html += `. ${escapeHtml(e.journal)}`;
      if (e.volume) html += `, <em>${escapeHtml(e.volume)}</em>`;
      if (e.pages) html += `, ${escapeHtml(e.pages)}`;
    } else if (e.booktitle) {
      html += `. In <em>${escapeHtml(e.booktitle)}</em>`;
    } else if (e.publisher) {
      html += `. ${escapeHtml(e.publisher)}`;
    }
    const href = hrefFor(e);
    if (href) html += `. <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`;
    html += `.</p>`;
    return html;
  });

  return `<div class="references"><h2>References</h2>${items.join("")}</div>`;
}
