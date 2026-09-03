import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
}

/**
 * Splits a shell-style command line into argv, honouring quotes. The documented
 * invocations are plain enough that this needs no expansion or substitution.
 */
function splitArgv(line) {
  const argv = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = pattern.exec(line);
  while (match) {
    argv.push(match[1] ?? match[2] ?? match[3]);
    match = pattern.exec(line);
  }
  return argv;
}

/**
 * Every shell command line the project publishes for the examples: the `Usage:`
 * header of each example plus the bash fences in examples/README.md. Placeholder
 * lines and REPL transcripts (which carry a prompt prefix) are not invocations.
 */
async function documentedInvocations(examples, readmePath) {
  const lines = [];
  for (const example of examples) {
    const source = await readFile(example, "utf8");
    const usage = source.match(/^ \* Usage:\n((?: \* {3}.*\n)+)/m);
    if (!usage) continue;
    for (const raw of usage[1].split("\n")) {
      const text = raw.replace(/^ \*\s{0,3}/, "").trim();
      if (text) lines.push(text);
    }
  }
  const readme = await readFile(readmePath, "utf8");
  for (const fence of readme.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of fence[1].split("\n")) {
      const text = raw.trim();
      if (text) lines.push(text);
    }
  }

  const seen = new Set();
  const invocations = [];
  for (const line of lines) {
    // Drop the trailing prose comment; what precedes it is still a real command.
    const command = line.replace(/\s+#.*$/, "").trim();
    if (!command.startsWith("npx tsx examples/")) continue;
    // A placeholder, not something that can be run.
    if (command.includes("<filename>")) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    const argv = splitArgv(command).slice(2);
    invocations.push({ command, script: argv[0], args: argv.slice(1) });
  }
  return invocations;
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
  const { stdout } = run(
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
    if (help.stdout.includes("Error:")) throw new Error(`${name} printed an error for --help`);
  }

  // Every invocation the project tells users to run has to actually run.
  const invocations = await documentedInvocations(examples, resolve(root, "examples/README.md"));
  if (invocations.length === 0) throw new Error("No documented example invocations were found");
  for (const { command, script, args } of invocations) {
    const compiled = resolve(output, script.replace(/\.ts$/, ".js"));
    const result = run(process.execPath, [compiled, ...args], {
      cwd: root,
      // Closed stdin: a documented invocation must not depend on a terminal.
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.stderr.includes("Error:")) {
      throw new Error(`${command} printed an error:\n${result.stderr}`);
    }
  }

  process.stdout.write(`Example smoke passed (${invocations.length} documented invocations)\n`);
} finally {
  await rm(output, { recursive: true, force: true });
}
