import type { Writable } from "node:stream";
import {
  type ColorFn,
  type Colorizer,
  color,
  colorTag,
  createColorizer,
  createColorTag,
  isStyleName,
  isTTY,
  type SanitizeTerminalTextOptions,
  type StyleName,
  type StyleSpec,
  sanitizeTerminalText,
  setColorEnabled,
  truncateAnsi,
} from "../../src/index.js";

declare const stream: Writable;
declare const dynamicName: string;

// Known styles resolve to chainable functions.
const red: ColorFn = color.red;
const text: string = color.bold.underline("x");
const chained: ColorFn = color.red.bgWhite.italic;
void red;
void text;
void chained;

// @ts-expect-error unknown style name
color.gren;
// @ts-expect-error unknown link in a chain
color.red.bol;
// @ts-expect-error the proxy is readonly
color.red = color.green;
// @ts-expect-error a plain string cannot index the proxy
color[dynamicName];

// createColorizer takes any Writable and returns the same proxy type.
const proxy: Colorizer = createColorizer(stream);
const proxied: string = proxy.green("ok");
void proxied;
// @ts-expect-error the argument must be a Writable
createColorizer("stderr");
// @ts-expect-error the argument is required
createColorizer();

// isStyleName narrows a string to StyleName.
if (isStyleName(dynamicName)) {
  const name: StyleName = dynamicName;
  const fn: ColorFn = color[name];
  void fn;
}

// StyleSpec checks the first two links and leaves the rest to run time.
const specs: StyleSpec[] = ["cyan", "cyan.bold", "cyan.bold.underline", "grey.bgRed"];
void specs;
// @ts-expect-error typo in the second link
const typoSecond: StyleSpec = "cyan.bol";
// @ts-expect-error typo in the first link
const typoFirst: StyleSpec = "cya.bold";
// @ts-expect-error an unknown name is not a StyleSpec
const unknownSpec: StyleSpec = "sparkle";
void typoSecond;
void typoFirst;
void unknownSpec;

// A readonly tuple of known names is accepted where StyleName values are needed.
const names = ["red", "green"] as const;
const resolved: ColorFn[] = names.map((n) => color[n]);
void resolved;
const specList: readonly StyleSpec[] = ["red.bold"] as const;
void specList;

// The template tag is a TemplateStringsArray tag, bound to a stream.
const tag = createColorTag(stream);
const tagged: string = tag`{red ${1}}`;
const stdoutTagged: string = colorTag`{bold ok}`;
void tagged;
void stdoutTagged;
// @ts-expect-error the argument must be a Writable
createColorTag(42);
// @ts-expect-error the stream is required
createColorTag();

// setColorEnabled takes a boolean or "auto".
setColorEnabled(true);
setColorEnabled(false);
setColorEnabled("auto");
// @ts-expect-error no longer optional or tri-state through null
setColorEnabled(null);
// @ts-expect-error only "auto" is accepted as a string
setColorEnabled("on");
// @ts-expect-error the argument is required
setColorEnabled();

// resetColorEnabled left the public surface.
// @ts-expect-error not exported from the root
import { resetColorEnabled } from "../../src/index.js";

void resetColorEnabled;

// isTTY accepts any value.
const tty: boolean = isTTY(undefined) || isTTY(stream) || isTTY("x");
void tty;

// truncateAnsi names its third parameter `ellipsis`; the width is a number.
const cut: string = truncateAnsi("abcdef", 3, "..");
const uncut: string = truncateAnsi("abcdef", Number.POSITIVE_INFINITY);
void cut;
void uncut;
// @ts-expect-error the width is required
truncateAnsi("abcdef");
// @ts-expect-error the width is a number
truncateAnsi("abcdef", "3");

// sanitizeTerminalText takes the exported options type.
const options: SanitizeTerminalTextOptions = { singleLine: false, allowHyperlinks: false };
const clean: string = sanitizeTerminalText("x", options);
void clean;
// @ts-expect-error unknown option
sanitizeTerminalText("x", { multiLine: true });
