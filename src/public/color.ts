export type {
  AnsiSegment,
  ColorFn,
  ColorProxy,
  SanitizeTerminalTextOptions,
  StyleName,
  StyleSpec,
} from "../output/color.js";
export {
  c,
  color,
  createColorizer,
  createTemplateTag,
  isColorEnabled,
  isStyleName,
  sanitizeTerminalText,
  setColorEnabled,
  splitAnsi,
  splitGraphemes,
  streamIsTTY,
  stringWidth,
  stripAnsi,
  truncateAnsi,
} from "../output/color.js";
