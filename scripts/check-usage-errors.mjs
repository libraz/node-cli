import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MISUSE = /new (Error|TypeError|RangeError)\(/;
const EXEMPT = "// usage-error-exempt:";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args : walk(join(root, "src"));

let violations = 0;
for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (MISUSE.test(line) && !line.includes(EXEMPT)) {
        console.log(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
        violations++;
      }
    });
}

console.log(`${violations} unmarked misuse error(s)`);
process.exit(violations > 0 ? 1 : 0);
