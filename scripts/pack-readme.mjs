import { copyFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const readme = resolve(root, "README.md");
const npmReadme = resolve(root, "README.npm.md");
const readmeBackup = resolve(root, ".readme-backup");
const npmReadmeBackup = resolve(root, ".npm-readme-backup");

async function prepare() {
  await rm(readmeBackup, { force: true });
  await rm(npmReadmeBackup, { force: true });
  await copyFile(readme, readmeBackup);
  await rename(npmReadme, npmReadmeBackup);
  await copyFile(npmReadmeBackup, readme);
}

async function restore() {
  await rename(readmeBackup, readme);
  await rename(npmReadmeBackup, npmReadme);
}

const operation = process.argv[2];
if (operation === "prepare") await prepare();
else if (operation === "restore") await restore();
else throw new Error("Usage: node scripts/pack-readme.mjs <prepare|restore>");
