import { appendFile, readFile, writeFile } from "node:fs/promises";

export function extractChangelogSection(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## \\[${escaped}\\](?: - [^\\n]+)?\\n`, "m").exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const remainder = changelog.slice(match.index + match[0].length);
  const nextSection = remainder.search(/^## /m);
  const body = (nextSection === -1 ? remainder : remainder.slice(0, nextSection)).trim();
  if (!/^### /m.test(body) || !/^- /m.test(body)) {
    throw new Error(
      `CHANGELOG.md section ${version} must contain a category and at least one item`,
    );
  }
  return `## ${version}\n\n${body}\n`;
}

export function releaseMetadata(packageJson, changelog, tag) {
  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match package version ${expectedTag}`);
  }
  const prerelease = packageJson.version.includes("-");
  const qualifier = packageJson.version.split("-")[1]?.split(".")[0];
  const distTag = prerelease ? (qualifier === "beta" ? "beta" : "next") : "latest";
  return {
    version: packageJson.version,
    tag,
    prerelease,
    distTag,
    notes: extractChangelogSection(changelog, packageJson.version),
  };
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const tag = args.get("--tag") ?? process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("A release tag is required via --tag or GITHUB_REF_NAME");

  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const changelog = await readFile("CHANGELOG.md", "utf8");
  const metadata = releaseMetadata(packageJson, changelog, tag);

  const notesPath = args.get("--notes");
  if (notesPath) await writeFile(notesPath, metadata.notes, "utf8");
  const outputPath = args.get("--github-output") ?? process.env.GITHUB_OUTPUT;
  if (outputPath) {
    await appendFile(
      outputPath,
      `version=${metadata.version}\ndist_tag=${metadata.distTag}\nprerelease=${metadata.prerelease}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${JSON.stringify({ ...metadata, notes: undefined })}\n`);
}

if (process.argv[1]?.endsWith("release-metadata.mjs")) await main();
