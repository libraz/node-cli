import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
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
  const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !file.startsWith("dist/") && !file.startsWith("coverage/"));
  for (const file of files) {
    const destination = resolve(repository, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(root, file), destination);
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
