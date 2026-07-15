import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PRIVATE_FILE_MODE = 0o600;
const LOCK_RETRIES = 50;

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Manages a persistent command history backed by a file on disk.
 * Supports loading, adding, saving, and retrieving history entries
 * while enforcing a configurable maximum size.
 */
export class History {
  private readonly filePath: string;
  private readonly maxSize: number;
  private readonly filter?: (line: string) => string | null;
  private lines: string[] = [];
  private pending: string[] = [];

  /**
   * Creates a new History instance.
   * @param options - Configuration options.
   * @param options.filePath - Path to the history file on disk.
   * @param options.maxSize - Maximum number of entries to retain (default: 1000).
   */
  constructor(options: {
    filePath: string;
    maxSize?: number;
    filter?: (line: string) => string | null;
  }) {
    this.filePath = options.filePath;
    const maxSize = options.maxSize ?? 1000;
    if (!Number.isSafeInteger(maxSize) || maxSize < 0) {
      throw new RangeError("History maxSize must be a non-negative safe integer");
    }
    this.maxSize = maxSize;
    this.filter = options.filter;
  }

  private limit(lines: string[]): string[] {
    if (this.maxSize === 0) return [];
    return lines.length > this.maxSize ? lines.slice(-this.maxSize) : lines;
  }

  private async assertSafeExistingFile(): Promise<boolean> {
    try {
      const stats = await lstat(this.filePath);
      if (stats.isSymbolicLink()) throw new Error("refusing to use a symbolic link");
      if (!stats.isFile()) throw new Error("history path is not a regular file");
      if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
        throw new Error("history file is owned by another user");
      }
      if ((stats.mode & 0o777) !== PRIVATE_FILE_MODE) {
        await chmod(this.filePath, PRIVATE_FILE_MODE);
      }
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  private async readSafeLines(): Promise<string[]> {
    const exists = await this.assertSafeExistingFile();
    if (!exists) return [];
    const content = await readFile(this.filePath, "utf-8");
    return content.split("\n").filter((line) => line.length > 0);
  }

  /**
   * Loads history entries from the file on disk.
   * If the file does not exist or cannot be read, the history starts empty.
   * @returns A copy of the loaded history entries.
   */
  async load(): Promise<string[]> {
    try {
      this.lines = this.limit(await this.readSafeLines());
      this.pending = [];
    } catch (error) {
      // File doesn't exist or can't be read — start fresh
      this.lines = [];
      this.pending = [];
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: Could not load history from ${this.filePath}: ${message}\n`);
    }
    return [...this.lines];
  }

  /**
   * Adds a line to the history.
   * Empty or whitespace-only lines are ignored. Consecutive duplicate
   * entries are also skipped.
   * @param line - The command line string to add.
   */
  add(line: string): void {
    const filtered = this.filter ? this.filter(line) : line;
    if (filtered === null) return;
    const trimmed = filtered.trim();
    if (trimmed.length === 0 || this.maxSize === 0) return;

    // Skip if same as last entry
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === trimmed) {
      return;
    }

    this.lines.push(trimmed);
    this.pending.push(trimmed);

    this.lines = this.limit(this.lines);
    this.pending = this.limit(this.pending);
  }

  private async acquireLock(): Promise<Awaited<ReturnType<typeof open>>> {
    const lockPath = `${this.filePath}.lock`;
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        return await open(lockPath, "wx", PRIVATE_FILE_MODE);
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        await delay(10);
      }
    }
    throw new Error(`timed out waiting for history lock ${lockPath}`);
  }

  /**
   * Persists the current history entries to disk.
   * Creates the parent directory if it does not exist.
   * Writes a warning to stderr if saving fails.
   */
  async save(): Promise<void> {
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const lockPath = `${this.filePath}.lock`;
    let tempPath: string | undefined;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      lock = await this.acquireLock();

      const diskLines = await this.readSafeLines();
      const merged = [...diskLines];
      for (const line of this.pending) {
        if (merged[merged.length - 1] !== line) merged.push(line);
      }
      this.lines = this.limit(merged);

      tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      const temp = await open(tempPath, "wx", PRIVATE_FILE_MODE);
      try {
        const content = this.lines.length > 0 ? `${this.lines.join("\n")}\n` : "";
        await temp.writeFile(content, "utf-8");
        await temp.sync();
      } finally {
        await temp.close();
      }
      await rename(tempPath, this.filePath);
      tempPath = undefined;
      this.pending = [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: Could not save history to ${this.filePath}: ${message}\n`);
    } finally {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
      await lock?.close().catch(() => {});
      if (lock) await rm(lockPath, { force: true }).catch(() => {});
    }
  }

  /**
   * Returns a copy of all current history entries.
   * @returns An array of history entry strings.
   */
  entries(): string[] {
    return [...this.lines];
  }
}
