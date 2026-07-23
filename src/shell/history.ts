import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PRIVATE_FILE_MODE = 0o600;
const LOCK_RETRIES = 50;

/**
 * Milliseconds after which an orphaned lock file is considered stale and may be
 * broken. Comfortably beyond the retry budget ({@link LOCK_RETRIES} * 10ms) so a
 * lock held by a live, contending session is never mistaken for a stale one.
 */
const STALE_LOCK_MS = 10_000;

/**
 * Flags for reading the history file. `O_NOFOLLOW` makes the open fail with
 * `ELOOP` if the path is a symbolic link, so the symlink/uid/mode guard and the
 * subsequent read operate on a single inode with no path re-resolution in
 * between (TOCTOU-safe). `O_NOFOLLOW` is absent on some platforms (e.g. Windows),
 * where it degrades to a plain read.
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * Matches C0 control characters (including `\n`, `\r`, and DEL) and C1 control
 * characters. Such bytes would either break the one-entry-per-line file format
 * or, as OSC/CSI escape sequences replayed on history recall, allow terminal
 * state spoofing.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizing history entries requires matching C0/C1 control characters
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Strips control characters from a single logical history entry so it stays one
 * physical line and is safe to replay to the terminal on recall. Applied at both
 * trust boundaries: on {@link History.add} (raw or filter-produced input) and on
 * load (untrusted on-disk content).
 * @param line - The raw entry.
 * @returns The entry with all C0/C1 control characters removed.
 */
function sanitizeEntry(line: string): string {
  return line.replace(CONTROL_CHARS, "");
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

  private async readSafeLines(): Promise<string[]> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      // Open once with O_NOFOLLOW, then validate and read through the same file
      // descriptor. Re-resolving the path (lstat then open-by-path) would leave a
      // window for an attacker with write access to the directory to swap in a
      // symlink between the check and the read.
      handle = await open(this.filePath, READ_FLAGS);
    } catch (error) {
      // Missing file: start empty. A symlink surfaces as ELOOP via O_NOFOLLOW and
      // is propagated so load() reports it and refuses to follow the link.
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new Error("history path is not a regular file");
      if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
        throw new Error("history file is owned by another user");
      }
      if ((stats.mode & 0o777) !== PRIVATE_FILE_MODE) {
        await handle.chmod(PRIVATE_FILE_MODE);
      }
      const content = await handle.readFile("utf-8");
      return content
        .split("\n")
        .map(sanitizeEntry)
        .filter((line) => line.length > 0);
    } finally {
      await handle.close();
    }
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
    // Sanitize after filtering so a filter that emits control characters (or a
    // raw line containing them) cannot corrupt the one-entry-per-line format or
    // inject terminal escapes that replay on recall.
    const trimmed = sanitizeEntry(filtered).trim();
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
        const handle = await open(lockPath, "wx", PRIVATE_FILE_MODE);
        // Record the owning PID so a later session can confirm the holder is dead
        // before breaking a suspected-stale lock. Best effort: an empty lock file
        // (e.g. crash between open and write) falls back to mtime-based staleness.
        await handle.writeFile(String(process.pid), "utf-8").catch(() => {});
        return handle;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        // A stale lock orphaned by a killed/power-lost session would otherwise
        // disable persistence indefinitely. Break it and retry immediately;
        // otherwise back off for the normal contended case.
        if (await this.breakStaleLock(lockPath)) continue;
        await delay(10);
      }
    }
    throw new Error(`timed out waiting for history lock ${lockPath}`);
  }

  /**
   * Removes a lock file only when it is safe to conclude no live session holds
   * it: its mtime is older than {@link STALE_LOCK_MS} and, if a PID is recorded,
   * that process is no longer running.
   * @param lockPath - Path to the `.lock` file.
   * @returns `true` if a stale lock was removed and acquisition should be retried.
   */
  private async breakStaleLock(lockPath: string): Promise<boolean> {
    try {
      const stats = await lstat(lockPath);
      if (Date.now() - stats.mtimeMs < STALE_LOCK_MS) return false;
      const owner = await this.readLockOwner(lockPath);
      if (owner !== undefined && this.isProcessAlive(owner)) return false;
      await rm(lockPath, { force: true });
      return true;
    } catch {
      // Lock vanished or could not be inspected/removed: let the loop retry.
      return false;
    }
  }

  /**
   * Reads the owning PID recorded in a lock file, if any.
   * @param lockPath - Path to the `.lock` file.
   * @returns The recorded PID, or `undefined` when absent or unparseable.
   */
  private async readLockOwner(lockPath: string): Promise<number | undefined> {
    try {
      const pid = Number.parseInt((await readFile(lockPath, "utf-8")).trim(), 10);
      return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Checks whether a process is still running via a null signal.
   * @param pid - The process id to probe.
   * @returns `true` if the process exists (including when signalling is denied).
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // ESRCH means no such process; EPERM means it exists but we may not signal it.
      return isNodeError(error, "EPERM");
    }
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
