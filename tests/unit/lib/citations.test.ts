import { describe, it, expect } from "vitest";
import { parseBib, convertCitations, formatReferenceList } from "~/lib/citations";

const BIB = `
@article{powell2025,
  title = {A workflow for collecting stories},
  author = {Powell, Stephen and Smith, Jane},
  journal = {Evaluation},
  volume = {31},
  pages = {394-411},
  year = {2025},
  doi = {10.1177/example},
}

@book{friese2019single,
  title = {Qualitative Data Analysis},
  author = {Friese, Susanne},
  publisher = {Sage},
  year = {2019},
}
`;

describe("parseBib", () => {
  const lib = parseBib(BIB);
  it("indexes keys with family names and year", () => {
    expect(lib.get("powell2025")?.authors).toEqual(["Powell", "Smith"]);
    expect(lib.get("powell2025")?.year).toBe("2025");
    expect(lib.get("friese2019single")?.authors).toEqual(["Friese"]);
  });
  it("captures fields for the reference list", () => {
    expect(lib.get("powell2025")?.journal).toBe("Evaluation");
    expect(lib.get("powell2025")?.doi).toBe("10.1177/example");
  });
});

describe("convertCitations", () => {
  const lib = parseBib(BIB);
  it("converts a bracket citation to parenthetical APA (two authors)", () => {
    const { text, usedKeys } = convertCitations("see [@powell2025]", lib);
    expect(text).toBe("see ([Powell & Smith 2025](https://doi.org/10.1177/example))");
    expect(usedKeys.has("powell2025")).toBe(true);
  });
  it("handles a locator and author suppression", () => {
    const { text } = convertCitations("[-@friese2019single, p. 5]", lib);
    expect(text).toBe("(2019, p. 5)");
  });
  it("3+ authors use et al.", () => {
    const lib3 = parseBib("@misc{k,author={A, X and B, Y and C, Z},year={2020}}");
    expect(convertCitations("[@k]", lib3).text).toBe("(A et al. 2020)");
  });
  it("converts a bare @key to narrative style", () => {
    const { text } = convertCitations("As @friese2019single shows", lib);
    expect(text).toBe("As Friese (2019) shows");
  });
  it("renders an unknown key as (n.d.)", () => {
    expect(convertCitations("[@nope]", lib).text).toBe("(n.d.)");
  });
});

describe("formatReferenceList", () => {
  const lib = parseBib(BIB);
  it("renders an APA reference list for used keys", () => {
    const html = formatReferenceList(new Set(["powell2025"]), lib);
    expect(html).toContain("<h2>References</h2>");
    expect(html).toContain("Powell, &amp; Smith (2025).");
    expect(html).toContain("<em>A workflow for collecting stories</em>");
    expect(html).toContain("https://doi.org/10.1177/example");
  });
  it("returns empty when nothing is cited", () => {
    expect(formatReferenceList(new Set(), lib)).toBe("");
  });
});
