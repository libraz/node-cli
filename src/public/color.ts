export type { AnsiSegment, ColorFn } from "../output/color.js";
export {
  c,
  color,
  createColorizer,
  isColorEnabled,
  resetColorEnabled,
  sanitizeTerminalText,
  setColorEnabled,
  splitAnsi,
  splitGraphemes,
  streamIsTTY,
  stringWidth,
  stripAnsi,
  truncateAnsi,
} from "../output/color.js";
