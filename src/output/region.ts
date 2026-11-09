import type { Writable } from "node:stream";
import { guardCall } from "../guard.js";
import { isTTY } from "./color.js";

/**
 * Whether `stream` can draw cursor-addressed frames and status symbols: a TTY
 * whose `TERM` is not `dumb`. Colour is a separate question answered by
 * `isColorEnabled`, which honours `FORCE_COLOR` and `NO_COLOR`.
 */
export function canAnimate(stream: unknown): boolean {
  return isTTY(stream) && process.env.TERM !== "dumb";
}

/**
 * How the renderer that owns a stream's drawn region cooperates with other
 * writers. A progress bar, spinner, or multi-bar group is the owner for as long
 * as it has a frame on screen.
 */
export interface RegionOwner {
  /**
   * Escape sequence that erases the region currently on screen so another writer
   * can emit a clean line. Returns an empty string when nothing is drawn.
   * Implementations forget the erased layout, so the owner's next redraw starts
   * from a blank region rather than moving the cursor over the interposed text.
   */
  clear(): string;
  /** Redraws the region after another writer has used the stream. */
  redraw(): void;
}

const regionOwners = new WeakMap<Writable, RegionOwner>();

/**
 * Records the renderer that owns `stream`'s drawn region. Passing `null`
 * releases the claim.
 */
export function setRegionOwner(stream: Writable, owner: RegionOwner | null): void {
  if (owner) regionOwners.set(stream, owner);
  else regionOwners.delete(stream);
}

/**
 * Writes to `stream` without corrupting a region another renderer is drawing.
 *
 * Every framework-owned writer that is not the region's owner goes through here:
 * the logger, the router's diagnostics, and the lines a prompt prints itself.
 * Readline's own question line and input echo cannot be routed. Writing directly
 * instead appends to a frame that has no trailing newline, and the owner's next
 * redraw then erases the merged row — splicing the two outputs together in the
 * terminal's scrollback for good. Only writes to the stream the owner draws on
 * cooperate; logging to the same stream as a running spinner is the common case.
 *
 * A throwing owner never loses the caller's text: a failed clear writes the text
 * as is, and a failed redraw releases the claim.
 *
 * @returns Whatever the underlying write returned, so callers can keep applying
 * their own backpressure policy.
 */
export function writeThrough(stream: Writable, text: string): boolean {
  const owner = regionOwners.get(stream);
  if (!owner) return stream.write(text);
  const erase = guardCall(
    () => owner.clear(),
    () => "",
  );
  const accepted = stream.write(`${erase}${text}`);
  guardCall(
    () => owner.redraw(),
    () => setRegionOwner(stream, null),
  );
  return accepted;
}
