import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
