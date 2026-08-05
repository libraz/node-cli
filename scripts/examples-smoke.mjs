import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

const root = process.cwd();
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const output = await mkdtemp(resolve(tmpdir(), "node-cli-example-"));

try {
  const examples = (await readdir(resolve(root, "examples")))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => resolve(root, "examples", name));
  run(
    yarn,
    [
      "tsc",
      "--ignoreConfig",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "Node16",
      "--moduleResolution",
      "Node16",
      "--types",
      "node",
      "--rootDir",
      root,
      "--outDir",
      output,
      ...examples,
    ],
    { cwd: root },
  );
  const stdout = run(
    process.execPath,
    [resolve(output, "examples/01-minimal.js"), "greet", "World"],
    { cwd: root },
  );
  if (stdout !== "Hello, World!\n") throw new Error("Example output mismatch");
  for (const example of examples) {
    const name = basename(example).replace(/\.ts$/, ".js");
    const help = run(process.execPath, [resolve(output, "examples", name), "--help"], {
      cwd: root,
    });
    if (help.includes("Error:")) throw new Error(`${name} printed an error for --help`);
  }
  process.stdout.write("Example smoke passed\n");
} finally {
  await rm(output, { recursive: true, force: true });
}
