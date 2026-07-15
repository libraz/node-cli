import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

const keep = process.argv.includes("--keep");
const manifestIndex = process.argv.indexOf("--manifest");
const manifestPath = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : undefined;
const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const fixture = await mkdtemp(resolve(tmpdir(), "node-cli-pack-"));
let tarball;

try {
  const packed = JSON.parse(run(npm, ["pack", "--json"], { cwd: root }));
  if (!Array.isArray(packed) || !packed[0]?.filename)
    throw new Error("npm pack returned no artifact");
  tarball = resolve(root, packed[0].filename);
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (packed[0].name !== packageJson.name || packed[0].version !== packageJson.version) {
    throw new Error("Packed artifact metadata does not match package.json");
  }

  run(npm, ["init", "--yes"], { cwd: fixture });
  run(npm, ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture });
  await writeFile(
    resolve(fixture, "smoke.mjs"),
    'import { CLI } from "@libraz/node-cli";\nif (typeof CLI !== "function") throw new Error("CLI export missing");\n',
  );
  run(process.execPath, [resolve(fixture, "smoke.mjs")], { cwd: fixture });

  const installedDist = resolve(fixture, "node_modules/@libraz/node-cli/dist");
  for (const mapName of ["index.js.map", "index.d.ts.map"]) {
    const mapPath = resolve(installedDist, mapName);
    const sourceMap = JSON.parse(await readFile(mapPath, "utf8"));
    if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
      throw new Error(`${mapName} contains no source references`);
    }
    for (let index = 0; index < sourceMap.sources.length; index++) {
      if (sourceMap.sourcesContent?.[index]) continue;
      await access(resolve(dirname(mapPath), sourceMap.sources[index]));
    }
  }

  run(
    npm,
    ["install", "--save-dev", "@types/node@22", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: fixture },
  );
  const fixturePackagePath = resolve(fixture, "package.json");
  const fixturePackage = JSON.parse(await readFile(fixturePackagePath, "utf8"));
  await writeFile(
    fixturePackagePath,
    `${JSON.stringify(
      {
        ...fixturePackage,
        type: "module",
        bin: { myapp: "dist/cli.js" },
        scripts: { ...fixturePackage.scripts, build: "tsc" },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(resolve(fixture, "src"));
  await writeFile(
    resolve(fixture, "src/cli.ts"),
    `#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });
cli.command("greet <name>")
  .option("-u, --uppercase", { type: "boolean" })
  .action((ctx) => {
    const name = ctx.args.name as string;
    ctx.stdout.write(\`Hello, \${ctx.options.uppercase ? name.toUpperCase() : name}!\\n\`);
  });
await cli.start();
`,
  );
  run(
    yarn,
    [
      "tsc",
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "Node16",
      "--moduleResolution",
      "Node16",
      "--outDir",
      resolve(fixture, "dist"),
      resolve(fixture, "src/cli.ts"),
    ],
    { cwd: root },
  );
  const executable = resolve(fixture, "dist/cli.js");
  if (process.platform !== "win32") await chmod(executable, 0o755);
  const docsOutput =
    process.platform === "win32"
      ? run(process.execPath, [executable, "greet", "World", "--uppercase"], { cwd: fixture })
      : run(executable, ["greet", "World", "--uppercase"], { cwd: fixture });
  if (docsOutput !== "Hello, WORLD!\n") throw new Error("README quick start output mismatch");

  const manifest = { ...packed[0], filename: basename(tarball) };
  if (manifestPath) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  await rm(fixture, { recursive: true, force: true });
  if (!keep && tarball) await rm(tarball, { force: true });
}
