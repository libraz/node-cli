// Type-checks the library sources against the OLDEST @types/node this package
// claims to support, so a newer typing that the repository happens to develop
// against cannot hide an API that does not exist on the minimum runtime.
//
// Manual utility; run it with `yarn typecheck:min-types`. It is not part of any
// pipeline because it downloads a package on every run.
//
// The naive form of this check — installing an older @types/node next to a
// throwaway compiler and running it — resolves the project's own newer
// @types/node instead, and reports success without ever reading the pinned
// copy. This script therefore pins `typeRoots` and then proves, from the
// compiler's own resolution trace, which type definitions were actually loaded.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function minimumMajor(field, range) {
  const match = /^>=\s*(\d+)/.exec(range ?? "");
  if (!match) throw new Error(`${field} must declare a ">=<major>" minimum, found: ${range}`);
  return match[1];
}

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const compiler = resolve(root, "node_modules/.bin/tsc");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const engineMajor = minimumMajor("engines.node", manifest.engines?.node);
const typesMajor = minimumMajor(
  'peerDependencies["@types/node"]',
  manifest.peerDependencies?.["@types/node"],
);
if (engineMajor !== typesMajor) {
  throw new Error(
    `engines.node claims Node ${engineMajor} but the @types/node peer range claims ${typesMajor}`,
  );
}

// The compiler reports resolved paths with symlinks expanded, so the staging
// directory has to be compared in the same form.
const staging = await realpath(await mkdtemp(resolve(tmpdir(), "node-cli-min-types-")));
try {
  const install = run(npm, [
    "install",
    `@types/node@${typesMajor}`,
    "--prefix",
    staging,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
  ]);
  if (install.status !== 0) {
    throw new Error(`Installing @types/node@${typesMajor} failed\n${install.stderr}`);
  }

  const typeRoot = resolve(staging, "node_modules/@types");
  const installed = JSON.parse(await readFile(resolve(typeRoot, "node/package.json"), "utf8"));
  if (installed.version.split(".")[0] !== typesMajor) {
    throw new Error(`Expected @types/node@${typesMajor}, staged ${installed.version}`);
  }

  const check = run(compiler, [
    "-p",
    "tsconfig.json",
    "--noEmit",
    "--typeRoots",
    typeRoot,
    "--traceResolution",
  ]);
  const trace = `${check.stdout}${check.stderr}`;
  const resolution = /Type reference directive 'node' was successfully resolved to '([^']+)'/.exec(
    trace,
  );
  if (!resolution) {
    throw new Error("The compiler did not report how it resolved the Node type definitions");
  }
  if (!resolution[1].startsWith(`${typeRoot}/`)) {
    throw new Error(
      `The compiler read ${resolution[1]} instead of the staged @types/node@${typesMajor}`,
    );
  }

  if (check.status !== 0) {
    const diagnostics = trace
      .split("\n")
      .filter((line) => /error TS\d+/.test(line))
      .join("\n");
    throw new Error(`Type check against @types/node@${installed.version} failed\n${diagnostics}`);
  }

  process.stdout.write(`Type check passed against @types/node@${installed.version}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
