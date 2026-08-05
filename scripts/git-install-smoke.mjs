import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "node-cli-git-install-"));
const repository = resolve(temporaryRoot, "repository");
const consumer = resolve(temporaryRoot, "consumer");

try {
  await mkdir(repository);
  // Test the repository as consumers obtain it: a committed git archive. This
  // deliberately excludes untracked worktree files, which could otherwise
  // mask a missing package asset in a real `npm install git+...` invocation.
  const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], {
    cwd: root,
    stdio: "pipe",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    throw new Error(`git archive HEAD failed\n${archive.stderr?.toString() ?? ""}`);
  }
  const extraction = spawnSync("tar", ["-x", "-C", repository], {
    input: archive.stdout,
    stdio: "pipe",
  });
  if (extraction.status !== 0) {
    throw new Error(`Could not extract git archive\n${extraction.stderr?.toString() ?? ""}`);
  }

  run("git", ["init", "--quiet"], { cwd: repository });
  run("git", ["config", "user.email", "smoke@example.invalid"], { cwd: repository });
  run("git", ["config", "user.name", "Git Install Smoke"], { cwd: repository });
  run("git", ["add", "."], { cwd: repository });
  run("git", ["commit", "--quiet", "-m", "test: create smoke fixture"], { cwd: repository });

  await mkdir(consumer);
  run(npm, ["init", "--yes"], { cwd: consumer });
  run(npm, ["install", `git+${pathToFileURL(repository).href}`, "--no-audit", "--no-fund"], {
    cwd: consumer,
  });
  await writeFile(
    resolve(consumer, "smoke.mjs"),
    'import { CLI } from "@libraz/node-cli";\nif (typeof CLI !== "function") throw new Error("CLI export missing");\n',
  );
  run(process.execPath, [resolve(consumer, "smoke.mjs")], { cwd: consumer });
  process.stdout.write("Git dependency install smoke passed\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
