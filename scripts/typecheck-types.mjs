import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const typesDir = join(root, "tests", "types");
const tsc = join(root, "node_modules", ".bin", "tsc");

const configs = readdirSync(typesDir)
  .filter((f) => /^tsconfig\..+\.json$/.test(f) && f !== "tsconfig.base.json")
  .sort();

for (const config of configs) {
  console.log(`tsc -p tests/types/${config}`);
  const result = spawnSync(tsc, ["-p", join(typesDir, config)], { stdio: "inherit", cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
