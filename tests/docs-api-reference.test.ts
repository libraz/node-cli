import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = {
  en: {
    md: readFileSync("docs/en/api-reference.md", "utf8"),
    runHeading: /^#### Programmatic execution$/m,
    styleHeading: /^### Style types$/m,
  },
  ja: {
    md: readFileSync("docs/ja/api-reference.md", "utf8"),
    runHeading: /^#### プログラムからの実行$/m,
    styleHeading: /^### スタイルの型$/m,
  },
} as const;

/** Returns the text from the heading matched by `heading` up to the next heading of the same or a higher level. */
function section(md: string, heading: RegExp): string {
  const found = md.match(heading);
  if (!found || found.index === undefined) throw new Error(`heading not found: ${heading}`);
  const level = found[0].match(/^#+/)?.[0].length ?? 1;
  const rest = md.slice(found.index + found[0].length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, "m"));
  return next === -1 ? rest : rest.slice(0, next);
}

/** Returns the table row that starts with the given cell text. */
function row(md: string, firstCell: string): string {
  const line = md.split("\n").find((l) => l.startsWith(`| ${firstCell} |`));
  if (!line) throw new Error(`row not found: ${firstCell}`);
  return line;
}

describe.each(Object.entries(pages))("api reference (%s)", (_lang, page) => {
  it("describes help in the CommandNotFoundError entry", () => {
    expect(row(page.md, "`CommandNotFoundError`")).toContain("help");
  });

  it("names exitCode in the exit event entry", () => {
    expect(row(page.md, "`exit`")).toContain("exitCode");
  });

  it("does not call the colorizer a proxy", () => {
    const entries = [
      section(page.md, /^### `color`$/m),
      section(page.md, page.styleHeading),
      section(page.md, /^### `createColorizer`$/m),
    ];
    for (const entry of entries) expect(entry).not.toMatch(/proxy|プロキシ/i);
  });

  it('describes the leading "--" in the exec entry', () => {
    expect(section(page.md, page.runHeading)).toContain('"--"');
  });

  it("mentions < in the tokenize entry", () => {
    expect(section(page.md, /^### `tokenize`$/m)).toContain("<");
  });

  it("mentions the signal reason in the isCancellationError entry", () => {
    expect(section(page.md, /^### `isCancellationError`$/m)).toContain("reason");
  });
});
