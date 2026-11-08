#!/usr/bin/env node
/**
 * Fails when a name removed or renamed in the public interface still appears
 * in the exported source (`exports`) or in consumer-facing text (`docs`).
 * Patterns and scopes come from scripts/removed-names.json.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = JSON.parse(readFileSync(join(root, "scripts", "removed-names.json"), "utf8"));

/** Lists files under `dir` (relative to the repo root) accepted by `keep`. */
function walk(dir, keep) {
  const out = [];
  const abs = join(root, dir);
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

const exportFiles = ["src/index.ts", ...walk("src/public", (f) => f.endsWith(".ts"))];
const docFiles = [
  ...walk("docs", (f) => f.endsWith(".md") && !/^docs\/[^/]+\/migration-v2\.md$/.test(f)),
  ...readdirSync(root).filter((f) => /^README.*\.md$/.test(f)),
  ...walk("examples", () => true),
];

const hits = [];

/** Records a hit at the first non-whitespace character of a match. */
function lineOf(text, match) {
  const lead = match[0].length - match[0].trimStart().length;
  return text.slice(0, match.index + lead).split("\n").length;
}

for (const rule of rules) {
  const scopes = rule.scope === "both" ? ["exports", "docs"] : [rule.scope];
  const fileFilters = rule.files?.map((f) => new RegExp(f));
  for (const scope of scopes) {
    const files = scope === "exports" ? exportFiles : docFiles;
    for (const file of files) {
      if (fileFilters && !fileFilters.some((re) => re.test(file))) continue;
      const text = readFileSync(join(root, file), "utf8");
      for (const source of rule.patterns) {
        if (scope === "exports") {
          const re = new RegExp(source, "gm");
          for (const m of text.matchAll(re)) hits.push(`${file}:${lineOf(text, m)}  ${source}`);
        } else {
          const re = new RegExp(source);
          text.split("\n").forEach((line, i) => {
            if (re.test(line)) hits.push(`${relative(root, join(root, file))}:${i + 1}  ${source}`);
          });
        }
      }
    }
  }
}

if (hits.length > 0) {
  console.error(hits.join("\n"));
  console.error(`\n${hits.length} removed names found`);
  process.exit(1);
}
console.log("0 removed names");
