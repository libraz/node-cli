import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const LANGS = ["en", "ja"] as const;

async function page(lang: string, file: string): Promise<string> {
  return readFile(`docs/${lang}/${file}`, "utf8");
}

async function guidePages(lang: string): Promise<string[]> {
  return (await readdir(`docs/${lang}`)).filter(
    (file) => file.endsWith(".md") && file !== "api-reference.md",
  );
}

/** Plain output fences that are neither a shell session nor a 1.x "before" sample. */
function directSamples(markdown: string): string[] {
  return [...markdown.matchAll(/^```(?:text)?\n([\s\S]*?)^```/gm)]
    .map((match) => match[1])
    .filter((block) => !/^\w*> /m.test(block) && !block.startsWith("# before"));
}

describe.each(LANGS)("guides (%s)", (lang) => {
  it("shows the shell-form hint only in interactive-shell.md", async () => {
    const offenders: string[] = [];
    for (const file of await guidePages(lang)) {
      if (file === "interactive-shell.md") continue;
      if (directSamples(await page(lang, file)).some((block) => block.includes('Type "help'))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(["examples.md", "getting-started.md"])("%s shows the direct-mode hint", async (file) => {
    expect(await page(lang, file)).toContain('Run "');
  });

  it("starts the direct-mode usage line with the program name", async () => {
    const text = await page(lang, "getting-started.md");
    expect(text).toMatch(/Usage: (?:myapp|mycli) /);
  });

  it("migration-v2.md has a section on the leading -- and one on the program name", async () => {
    const text = await page(lang, "migration-v2.md");
    const sections = text.split(/^### (?=\d+\.)/m).slice(1);
    expect(sections.some((s) => /^\d+\.[^\n]*`--`/.test(s))).toBe(true);
    expect(sections.some((s) => /^\d+\.[^\n]*\n[\s\S]*Usage: (?:app|myapp) /.test(s))).toBe(true);
  });

  it("events-and-plugins.md says help does not emit beforeExecute", async () => {
    const text = await page(lang, "events-and-plugins.md");
    expect(text).toMatch(/help[^\n]*`beforeExecute`|`beforeExecute`[^\n]*help/);
    expect(text).toContain("--version");
  });

  it("options.md describes binding -h", async () => {
    const text = await page(lang, "options.md");
    expect(text).toContain("-h");
    expect(text).toMatch(/-h, --help|`-h`[^\n]*`--help`|`--help`[^\n]*`-h`/);
    expect(text).toContain("help <command>");
  });

  it("errors.md covers usage prefix and signal reason", async () => {
    const text = await page(lang, "errors.md");
    expect(text).toMatch(/Usage: (?:myapp|mycli) /);
    expect(text).toContain("signal.reason");
  });

  it("getting-started.md covers the exit code of a successful run", async () => {
    expect(await page(lang, "getting-started.md")).toContain("process.exitCode");
  });
});

describe("CHANGELOG 2.0.0", () => {
  it("lists the program-name usage and the leading -- as breaking", async () => {
    const text = await readFile("CHANGELOG.md", "utf8");
    const section = text.split(/^## \[2\.0\.0\]/m)[1]?.split(/^## \[/m)[0] ?? "";
    const breaking = section.split(/^### Added/m)[0];
    expect(breaking).toContain("program name");
    expect(breaking).toContain("`--`");
  });
});
