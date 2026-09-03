import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Names exported as types, read from the built declaration file. Runtime
 * exports are read from the module itself; types have no runtime presence.
 */
function exportedTypeNames(declarations: string): string[] {
  const names: string[] = [];
  for (const match of declarations.matchAll(/export type \{([^}]*)\}/g)) {
    for (const entry of match[1].split(",")) {
      const name = entry.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Headings that are a single backticked identifier, in document order. */
function identifierHeadings(markdown: string): string[] {
  return [...markdown.matchAll(/^#{1,6}\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
}

function mentions(markdown: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(markdown);
}

describe("public surface and documentation agree", () => {
  it("documents every export in the English API reference", async () => {
    // `pretest` builds before vitest runs, so the declaration file is present.
    const [api, declarations, reference] = await Promise.all([
      import("../src/index.js"),
      readFile("dist/index.d.ts", "utf8"),
      readFile("docs/en/api.md", "utf8"),
    ]);
    const exported = [...Object.keys(api), ...exportedTypeNames(declarations)].sort();

    expect(exported.filter((name) => !mentions(reference, name))).toEqual([]);
  });

  it("mirrors every documented identifier heading in the Japanese reference", async () => {
    const englishDir = "docs/en";
    const files = (await readdir(englishDir)).filter((file) => file.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of files) {
      const [english, japanese] = await Promise.all([
        readFile(join(englishDir, file), "utf8"),
        readFile(join("docs/ja", file), "utf8"),
      ]);
      const translated = new Set(identifierHeadings(japanese));
      for (const heading of identifierHeadings(english)) {
        if (!translated.has(heading)) missing.push(`${file}: ${heading}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
