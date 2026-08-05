import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractChangelogSection, releaseMetadata } from "../scripts/release-metadata.mjs";

describe("release metadata", () => {
  const changelog = "# Changelog\n\n## [1.2.3] - 2026-01-01\n\n### Fixed\n\n- A fix.\n";

  it.each([
    ["1.2.3", "latest", false],
    ["1.2.3-beta.1", "beta", true],
    ["1.2.3-rc.1", "next", true],
  ])("classifies %s with the safe npm dist-tag", (version, distTag, prerelease) => {
    const versionChangelog = changelog.replaceAll("1.2.3", version);
    expect(releaseMetadata({ version }, versionChangelog, `v${version}`)).toMatchObject({
      distTag,
      prerelease,
    });
  });

  it("fails fast when tag, package, or changelog versions differ", () => {
    expect(() => releaseMetadata({ version: "1.2.3" }, changelog, "v1.2.4")).toThrow(
      "does not match",
    );
    expect(() => extractChangelogSection(changelog, "9.9.9")).toThrow("no section");
  });

  it("accepts the repository package and changelog", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const actualChangelog = await readFile("CHANGELOG.md", "utf8");
    expect(
      releaseMetadata(packageJson, actualChangelog, `v${packageJson.version}`).notes,
    ).toContain(`## ${packageJson.version}`);
  });

  it("exposes an ESM fallback and package metadata through exports", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.exports["."].default).toBe("./dist/index.js");
    expect(packageJson.exports["./package.json"]).toBe("./package.json");
  });

  it("does not expose Shell as a constructible public runtime value", async () => {
    const api = await import("../src/index.js");
    expect("Shell" in api).toBe(false);
  });

  it("does not expose internal command definitions in its type declarations", async () => {
    const declarations = await readFile("dist/index.d.ts", "utf8");
    for (const typeName of ["ArgDef", "CommandDefinition", "OptionDef", "ParseResult"]) {
      expect(declarations).not.toMatch(new RegExp(`\\b${typeName}\\b`));
    }
  });
});
