// Type-checks a consumer program against the built declarations with the OLDEST
// TypeScript and @types/node this package claims to support, with
// `skipLibCheck: false` so the declarations themselves are checked too. A syntax
// or feature newer than the minimum compiler would otherwise only fail for users.
//
// Run it with `yarn typecheck:min-ts` after `yarn build`; CI runs it. It
// downloads packages on every run.
//
// The pinned packages are installed into a throwaway directory and the compiler
// is run from there with `typeRoots` pinned; the script then proves from the
// compiler's own resolution trace that the pinned @types/node was the one read.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const MIN_TYPESCRIPT = "5.4";
const MIN_TYPES_NODE = "22.0.0";

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

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const staging = await realpath(await mkdtemp(resolve(tmpdir(), "node-cli-min-ts-")));
try {
  const install = run(npm, [
    "install",
    `typescript@~${MIN_TYPESCRIPT}`,
    `@types/node@${MIN_TYPES_NODE}`,
    "--prefix",
    staging,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
  ]);
  if (install.status !== 0) {
    throw new Error(`Installing the minimum toolchain failed\n${install.stderr}`);
  }

  const typeRoot = resolve(staging, "node_modules/@types");
  const compiler = resolve(staging, "node_modules/typescript");
  const tsVersion = JSON.parse(await readFile(resolve(compiler, "package.json"), "utf8")).version;
  const typesVersion = JSON.parse(
    await readFile(resolve(typeRoot, "node/package.json"), "utf8"),
  ).version;
  if (!tsVersion.startsWith(`${MIN_TYPESCRIPT}.`) || typesVersion !== MIN_TYPES_NODE) {
    throw new Error(`Staged typescript@${tsVersion} and @types/node@${typesVersion}`);
  }

  const config = resolve(staging, "tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ["node"],
        typeRoots: [typeRoot],
      },
      files: [resolve(root, "tests/types/min-ts/consumer.ts")],
    }),
  );

  const check = run(process.execPath, [
    resolve(compiler, "bin/tsc"),
    "-p",
    config,
    "--traceResolution",
  ]);
  const trace = `${check.stdout}${check.stderr}`;
  const resolution = /Type reference directive 'node' was successfully resolved to '([^']+)'/.exec(
    trace,
  );
  if (!resolution?.[1].startsWith(`${typeRoot}/`)) {
    throw new Error(
      `The compiler did not read the staged @types/node@${typesVersion}: ${resolution?.[1]}`,
    );
  }
  if (check.status !== 0) {
    const diagnostics = trace
      .split("\n")
      .filter((line) => /error TS\d+/.test(line))
      .join("\n");
    throw new Error(
      `Type check against typescript@${tsVersion} and @types/node@${typesVersion} failed\n${diagnostics}`,
    );
  }

  process.stdout.write(
    `Type check passed against typescript@${tsVersion} and @types/node@${typesVersion}\n`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
