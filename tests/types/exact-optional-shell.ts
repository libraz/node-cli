import type { Completer, ModeOptions } from "../../dist/index.js";

declare const banner: string | undefined;
declare const completer: readonly string[] | Completer | undefined;
declare const history: "session" | "none" | undefined;

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into optional members.
const modeOptions: ModeOptions = {
  prompt: "> ",
  action: () => {},
  banner,
  completer,
  history,
};
void modeOptions;
