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

/** Backticked code spans anywhere in the document. */
function codeSpans(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]));
}

/** First-column names of the rows under the "Export index" heading. */
function exportIndexNames(markdown: string): string[] {
  const section = markdown.split(/^## Export index\s*$/m)[1] ?? "";
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
}

/** Contents of every typescript fence. */
function typescriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\n([\s\S]*?)```/g)].map((match) => match[1]);
}

const DECLARATION =
  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|enum)\s+(\w+)/;

/**
 * Capitalised identifiers used in each type-level declaration under dist,
 * keyed by declared name. Declarations end at the next top-level statement.
 */
async function declaredTypes(directory: string): Promise<Map<string, Set<string>>> {
  const declared = new Map<string, Set<string>>();
  const entries = await readdir(directory, { recursive: true });
  for (const entry of entries.filter((file) => file.endsWith(".d.ts"))) {
    const lines = (await readFile(join(directory, entry), "utf8")).split("\n");
    let current: Set<string> | null = null;
    for (const line of lines) {
      const match = DECLARATION.exec(line);
      if (match) {
        current = new Set();
        declared.set(match[1], current);
      } else if (/^\S/.test(line) && !line.startsWith("}") && !line.startsWith("*")) {
        current = null;
      }
      if (current && !line.startsWith("/**") && !/^\s*(\*|\/\/)/.test(line)) {
        for (const id of line.matchAll(/\b[A-Z]\w*\b/g)) current.add(id[0]);
      }
    }
  }
  return declared;
}

async function loadSurface() {
  // `pretest` builds before vitest runs, so the declaration files are present.
  const [api, declarations, reference, declared] = await Promise.all([
    import("../src/index.js"),
    readFile("dist/index.d.ts", "utf8"),
    readFile("docs/en/api-reference.md", "utf8"),
    declaredTypes("dist"),
  ]);
  const exported = new Set([...Object.keys(api), ...exportedTypeNames(declarations)]);
  return { exported, reference, declared };
}

describe("public surface and documentation agree", () => {
  it("documents every export as a code span or an export-index row", async () => {
    const { exported, reference } = await loadSurface();
    const documented = codeSpans(reference);

    expect([...exported].filter((name) => !documented.has(name)).sort()).toEqual([]);
    expect(
      [...exported].filter((name) => !exportIndexNames(reference).includes(name)).sort(),
    ).toEqual([]);
  });

  it("lists only real exports in the export index", async () => {
    const { exported, reference } = await loadSurface();
    const rows = exportIndexNames(reference);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((name) => !exported.has(name))).toEqual([]);
  });

  it("exports every type named by an exported declaration", async () => {
    const { exported, declared } = await loadSurface();

    const missing: string[] = [];
    for (const name of exported) {
      for (const used of declared.get(name) ?? []) {
        if (used !== name && declared.has(used) && !exported.has(used)) {
          missing.push(`${name} -> ${used}`);
        }
      }
    }

    expect(missing.sort()).toEqual([]);
  });

  it("exports every type named in a documented signature", async () => {
    const { exported, reference, declared } = await loadSurface();

    const used = new Set<string>();
    for (const block of typescriptBlocks(reference)) {
      for (const id of block.matchAll(/\b[A-Z]\w*\b/g)) used.add(id[0]);
    }

    expect([...used].filter((name) => declared.has(name) && !exported.has(name)).sort()).toEqual(
      [],
    );
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
