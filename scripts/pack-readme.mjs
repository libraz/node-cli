import { access, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const readme = resolve(root, "README.md");
const npmReadme = resolve(root, "README.npm.md");
const readmeBackup = resolve(root, ".readme-backup");
const npmReadmeBackup = resolve(root, ".npm-readme-backup");
const marker = resolve(root, ".pack-readme-active");
const MARKER_CONTENT = "node-cli-pack-readme-v1\n";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepare() {
  if ((await exists(readmeBackup)) || (await exists(npmReadmeBackup)) || (await exists(marker))) {
    throw new Error("README swap is already active; run restore before preparing again");
  }

  // Copy rather than rename so an interruption never removes the source README.
  await copyFile(readme, readmeBackup);
  await copyFile(npmReadme, npmReadmeBackup);
  // The marker is written before the visible swap, so restore can distinguish a
  // recoverable interrupted prepare from an unrelated backup file.
  await writeFile(marker, MARKER_CONTENT, { flag: "wx" });
  await copyFile(npmReadme, readme);
}

async function restore() {
  if (!(await exists(marker))) {
    if (!(await exists(readmeBackup)) && !(await exists(npmReadmeBackup))) return;
    throw new Error(
      "README swap backups exist without a valid marker; refusing to overwrite README",
    );
  }
  if ((await readFile(marker, "utf8")) !== MARKER_CONTENT) {
    throw new Error("README swap marker is invalid; refusing to overwrite README");
  }
  if (!(await exists(readmeBackup)) || !(await exists(npmReadmeBackup))) {
    throw new Error(
      "README swap marker exists but a backup is missing; refusing to overwrite README",
    );
  }

  await copyFile(readmeBackup, readme);
  await rm(readmeBackup);
  await rm(npmReadmeBackup);
  await rm(marker);
}

const operation = process.argv[2];
if (operation === "prepare") await prepare();
else if (operation === "restore") await restore();
else throw new Error("Usage: node scripts/pack-readme.mjs <prepare|restore>");
