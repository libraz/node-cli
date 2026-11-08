import type { Writable } from "node:stream";
import {
  type Bar,
  type BarOptions,
  type BarState,
  type MultiBar,
  type MultiBarOptions,
  progress,
  type Spinner,
  type SpinnerOptions,
} from "../../src/index.js";

declare const stream: Writable;

// The three handles share the same terminal verbs, all returning void.
declare const bar: Bar;
declare const spinner: Spinner;
declare const multi: MultiBar;
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type VoidReturn = ReturnType<() => void>;
const barSucceedVoid: Same<ReturnType<typeof bar.succeed>, VoidReturn> = true;
const spinnerFailVoid: Same<ReturnType<typeof spinner.fail>, VoidReturn> = true;
const multiWarnVoid: Same<ReturnType<typeof multi.warn>, VoidReturn> = true;
void [barSucceedVoid, spinnerFailVoid, multiWarnVoid];
bar.stop();
spinner.stop();
multi.stop();
spinner.setLabel("next");

// Creation takes the options shape and returns the handle directly.
const created: Bar = progress.bar({ total: 10, label: "x", color: "green", stream });
const chained: Bar = progress.bar({ total: 10, color: "bold.cyan" });
const spin: Spinner = progress.spinner({ intervalMs: 80, frames: ["a", "b"], color: "cyan" });
const group: MultiBar = progress.multi({ stream });
const added: Bar = group.add({ total: 3, label: "file" });
void [created, chained, spin, added];

// frames accepts a readonly array.
const frames = ["-", "\\", "|", "/"] as const;
const spinnerOptions: SpinnerOptions = { frames };
void spinnerOptions;

// BarState uses unit-suffixed names.
const format: BarOptions["format"] = (state: BarState) =>
  `${state.elapsedMs} ${state.etaMs} ${state.ratePerSecond} ${state.percent}`;
void format;

const groupOptions: MultiBarOptions = { stream };
void groupOptions;

// @ts-expect-error unknown style names are rejected
progress.bar({ total: 1, color: "nonsense" });

// @ts-expect-error the interval option is intervalMs
progress.spinner({ interval: 80 });

// @ts-expect-error finish was replaced by succeed
bar.finish();

// @ts-expect-error spinners start when created
spinner.start();

// @ts-expect-error update was renamed setLabel
spinner.update("x");

// @ts-expect-error a bar added to a group uses the group's stream
group.add({ total: 1, stream });

// @ts-expect-error BarState fields carry their unit
const oldElapsed = ((state: BarState) => state.elapsed) as unknown;
void oldElapsed;

// @ts-expect-error the cursor helpers are not part of the public entry
import { restoreCursor } from "../../src/index.js";

void restoreCursor;
