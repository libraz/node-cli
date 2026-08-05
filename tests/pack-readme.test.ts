import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/pack-readme.mjs");

function run(fixture: string, operation: "prepare" | "restore") {
  return spawnSync(process.execPath, [script, operation], {
    cwd: fixture,
    encoding: "utf8",
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "node-cli-pack-readme-"));
  await writeFile(join(directory, "README.md"), "development README\n");
  await writeFile(join(directory, "README.npm.md"), "npm README\n");
  return directory;
}

describe("pack README swap", () => {
  it("rejects a second prepare without losing the original README", async () => {
    const directory = await fixture();
    try {
      expect(run(directory, "prepare").status).toBe(0);
      const second = run(directory, "prepare");
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("already active");
      expect(await readFile(join(directory, "README.md"), "utf8")).toBe("npm README\n");

      expect(run(directory, "restore").status).toBe(0);
      expect(await readFile(join(directory, "README.md"), "utf8")).toBe("development README\n");
      expect(await readFile(join(directory, "README.npm.md"), "utf8")).toBe("npm README\n");
      await expect(access(join(directory, ".pack-readme-active"))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows an orphaned restore with no swap state", async () => {
    const directory = await fixture();
    try {
      const result = run(directory, "restore");
      expect(result.status).toBe(0);
      expect(await readFile(join(directory, "README.md"), "utf8")).toBe("development README\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to restore an incomplete marked swap", async () => {
    const directory = await fixture();
    try {
      await writeFile(join(directory, ".pack-readme-active"), "node-cli-pack-readme-v1\n");
      const result = run(directory, "restore");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("backup is missing");
      expect(await readFile(join(directory, "README.md"), "utf8")).toBe("development README\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
