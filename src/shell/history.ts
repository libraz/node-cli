import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Manages a persistent command history backed by a file on disk.
 * Supports loading, adding, saving, and retrieving history entries
 * while enforcing a configurable maximum size.
 */
export class History {
  private readonly filePath: string;
  private readonly maxSize: number;
  private lines: string[] = [];

  /**
   * Creates a new History instance.
   * @param options - Configuration options.
   * @param options.filePath - Path to the history file on disk.
   * @param options.maxSize - Maximum number of entries to retain (default: 1000).
   */
  constructor(options: { filePath: string; maxSize?: number }) {
    this.filePath = options.filePath;
    this.maxSize = options.maxSize ?? 1000;
  }

  /**
   * Loads history entries from the file on disk.
   * If the file does not exist or cannot be read, the history starts empty.
   * @returns A copy of the loaded history entries.
   */
  async load(): Promise<string[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      this.lines = content.split("\n").filter((line) => line.length > 0);
      // Trim to max size
      if (this.lines.length > this.maxSize) {
        this.lines = this.lines.slice(-this.maxSize);
      }
    } catch {
      // File doesn't exist or can't be read — start fresh
      this.lines = [];
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
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    // Skip if same as last entry
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === trimmed) {
      return;
    }

    this.lines.push(trimmed);

    // Trim to max size
    if (this.lines.length > this.maxSize) {
      this.lines = this.lines.slice(-this.maxSize);
    }
  }

  /**
   * Persists the current history entries to disk.
   * Creates the parent directory if it does not exist.
   * Writes a warning to stderr if saving fails.
   */
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, this.lines.join("\n") + "\n", "utf-8");
    } catch (err) {
      process.stderr.write(`Warning: Could not save history to ${this.filePath}: ${err}\n`);
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
