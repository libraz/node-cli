import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { History } from "../src/shell/history.js";

describe("History", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `node-cli-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    filePath = join(tempDir, "history");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads from file", async () => {
    await writeFile(filePath, "cmd1\ncmd2\ncmd3\n");
    const history = new History({ filePath });
    const entries = await history.load();
    expect(entries).toEqual(["cmd1", "cmd2", "cmd3"]);
  });

  it("starts empty when file does not exist", async () => {
    const history = new History({ filePath: join(tempDir, "nonexistent") });
    const entries = await history.load();
    expect(entries).toEqual([]);
  });

  it("adds entries", () => {
    const history = new History({ filePath });
    history.add("cmd1");
    history.add("cmd2");
    expect(history.entries()).toEqual(["cmd1", "cmd2"]);
  });

  it("skips empty entries", () => {
    const history = new History({ filePath });
    history.add("");
    history.add("   ");
    expect(history.entries()).toEqual([]);
  });

  it("skips consecutive duplicates", () => {
    const history = new History({ filePath });
    history.add("cmd1");
    history.add("cmd1");
    history.add("cmd2");
    history.add("cmd1");
    expect(history.entries()).toEqual(["cmd1", "cmd2", "cmd1"]);
  });

  it("enforces max size", () => {
    const history = new History({ filePath, maxSize: 3 });
    history.add("cmd1");
    history.add("cmd2");
    history.add("cmd3");
    history.add("cmd4");
    expect(history.entries()).toEqual(["cmd2", "cmd3", "cmd4"]);
  });

  it("saves to file", async () => {
    const history = new History({ filePath });
    history.add("cmd1");
    history.add("cmd2");
    await history.save();

    const history2 = new History({ filePath });
    const entries = await history2.load();
    expect(entries).toEqual(["cmd1", "cmd2"]);
  });

  it("trims on load when file exceeds maxSize", async () => {
    await writeFile(filePath, "a\nb\nc\nd\ne\n");
    const history = new History({ filePath, maxSize: 3 });
    const entries = await history.load();
    expect(entries).toEqual(["c", "d", "e"]);
  });

  it.runIf(process.platform !== "win32")("creates and repairs history files as 0600", async () => {
    const history = new History({ filePath });
    history.add("secret --token value");
    await history.save();
    expect((await lstat(filePath)).mode & 0o777).toBe(0o600);

    await writeFile(filePath, "old\n", { mode: 0o644 });
    await new History({ filePath }).load();
    expect((await lstat(filePath)).mode & 0o777).toBe(0o600);
  });

  it.runIf(process.platform !== "win32")("refuses to follow a history symlink", async () => {
    const target = join(tempDir, "target");
    await writeFile(target, "do-not-read\n");
    await symlink(target, filePath);
    const history = new History({ filePath });
    expect(await history.load()).toEqual([]);
    expect(await readFile(target, "utf8")).toBe("do-not-read\n");
  });

  it("merges concurrent session additions under a lock", async () => {
    const first = new History({ filePath });
    const second = new History({ filePath });
    await Promise.all([first.load(), second.load()]);
    first.add("from-first");
    second.add("from-second");
    await Promise.all([first.save(), second.save()]);

    const loaded = await new History({ filePath }).load();
    expect(loaded).toHaveLength(2);
    expect(loaded).toEqual(expect.arrayContaining(["from-first", "from-second"]));
  });

  it.runIf(existsSync("dist/shell/history.js"))(
    "merges stale snapshots saved concurrently by separate processes",
    async () => {
      const startPath = join(tempDir, "start");
      const readyPaths = [join(tempDir, "ready-1"), join(tempDir, "ready-2")];
      const children = readyPaths.map((readyPath, index) =>
        spawn(
          process.execPath,
          [
            join(process.cwd(), "tests/fixtures/history-writer-child.mjs"),
            filePath,
            readyPath,
            startPath,
            `child-${index + 1}`,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        ),
      );
      let stderr = "";
      for (const child of children) {
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      await vi.waitFor(() => expect(readyPaths.every(existsSync)).toBe(true));
      await writeFile(startPath, "start");
      const exits = await Promise.all(children.map((child) => once(child, "exit")));
      expect(exits).toEqual([
        [0, null],
        [0, null],
      ]);
      expect(stderr).toBe("");

      const loaded = await new History({ filePath }).load();
      expect(loaded).toEqual(expect.arrayContaining(["child-1", "child-2"]));
    },
  );

  it("treats maxSize 0 as disabled and validates invalid sizes", async () => {
    const disabled = new History({ filePath, maxSize: 0 });
    disabled.add("ignored");
    await disabled.save();
    expect(disabled.entries()).toEqual([]);
    expect(await readFile(filePath, "utf8")).toBe("");
    expect(() => new History({ filePath, maxSize: -1 })).toThrow(RangeError);
    expect(() => new History({ filePath, maxSize: Number.NaN })).toThrow(RangeError);
  });

  it("can redact or omit secret-bearing commands", () => {
    const history = new History({
      filePath,
      filter: (line) => {
        if (line.startsWith("login ")) return null;
        return line.replace(/--token\s+\S+/, "--token [REDACTED]");
      },
    });
    history.add("deploy --token secret");
    history.add("login password");
    expect(history.entries()).toEqual(["deploy --token [REDACTED]"]);
  });
});
