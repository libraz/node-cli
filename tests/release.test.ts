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
});
