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
const tsc = resolve(root, "node_modules/typescript/bin/tsc");
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
  // npm force-includes every root file matching `readme.*`; only one may survive.
  const readmeEntries = (packed[0].files ?? [])
    .map((entry) => entry.path)
    .filter((path) => /^readme(\..*)?$/i.test(path));
  if (readmeEntries.length !== 1 || readmeEntries[0] !== "README.md") {
    throw new Error(`Packed tarball must carry exactly one README: ${readmeEntries.join(", ")}`);
  }

  run(npm, ["init", "--yes"], { cwd: fixture });
  run(npm, ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture });
  const installedRoot = resolve(fixture, "node_modules/@libraz/node-cli");
  const installedPackage = JSON.parse(
    await readFile(resolve(installedRoot, "package.json"), "utf8"),
  );
  if (installedPackage.description !== packageJson.description) {
    throw new Error("Packed package description does not match package.json");
  }
  if (installedPackage.engines?.node !== packageJson.engines.node) {
    throw new Error("Packed Node.js engine does not match package.json");
  }
  const installedReadme = await readFile(resolve(installedRoot, "README.md"));
  const npmReadme = await readFile(resolve(root, "README.npm.md"));
  const developmentReadme = await readFile(resolve(root, "README.md"));
  if (!installedReadme.equals(npmReadme) || installedReadme.equals(developmentReadme)) {
    throw new Error("Packed README is not the npm-specific README");
  }
  await writeFile(
    resolve(fixture, "smoke.mjs"),
    'import { createCLI } from "@libraz/node-cli";\nif (typeof createCLI !== "function") throw new Error("createCLI export missing");\n',
  );
  run(process.execPath, [resolve(fixture, "smoke.mjs")], { cwd: fixture });

  const installedDist = resolve(installedRoot, "dist");
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
    const name = ctx.args.name;
    ctx.stdout.write(\`Hello, \${ctx.options.uppercase ? name.toUpperCase() : name}!\\n\`);
  });
await cli.start();
`,
  );
  // Run from the fixture so `--types node` resolves the staged @types/node, and keep
  // library checking on so the shipped declarations are type-checked too.
  run(
    process.execPath,
    [
      tsc,
      "--ignoreConfig",
      "--strict",
      "--types",
      "node",
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
    { cwd: fixture },
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
