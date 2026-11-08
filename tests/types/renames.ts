import type {
  CLIErrorCode,
  Colorizer,
  ColorTag,
  ModeAction,
  ModeContext,
  ModeOptions,
} from "../../src/index.js";
import * as api from "../../src/index.js";

// New names exist with the documented shapes.
const colorizer: Colorizer = api.color;
const tag: ColorTag = api.colorTag;
const made: ColorTag = api.createColorTag(process.stderr);
const action: ModeAction = (input: string, ctx: ModeContext) => {
  void input;
  void ctx;
};
const mode: ModeOptions = { prompt: "> ", action };
const tty: boolean = api.isTTY(process.stdout);
const cancelled: Error = new api.CancelledError();
const codes: CLIErrorCode[] = ["VALIDATION_FAILED", "PARSE_FAILED", "CANCELLED"];
api.progress.bar({ total: 1, stderr: process.stderr, style: "cyan" });
api.progress.spinner({ stderr: process.stderr, style: "cyan" });
api.progress.multi({ stderr: process.stderr }).add({ total: 1, style: "cyan" });
api.createLogger({ stderr: process.stderr });
api.table([["a"]], { borderStyle: "cyan", stream: process.stdout });
void [colorizer, tag, made, mode, tty, cancelled, codes];

// Old names are gone.
// @ts-expect-error removed
api.streamIsTTY;
// @ts-expect-error removed
api.c;
// @ts-expect-error removed
api.createTemplateTag;
// @ts-expect-error removed
api.PromptCancelError;
// @ts-expect-error removed
export type OldModeConfig = api.ModeConfig;
// @ts-expect-error removed
export type OldColorProxy = api.ColorProxy;
// @ts-expect-error removed
const oldCode: CLIErrorCode = "VALIDATION_ERROR";
// @ts-expect-error removed
const oldParse: CLIErrorCode = "PARSE_ERROR";
// @ts-expect-error removed
const oldCancel: CLIErrorCode = "PROMPT_CANCELLED";
// @ts-expect-error removed
api.createLogger({ stream: process.stderr });
// @ts-expect-error removed
api.progress.bar({ total: 1, stream: process.stderr });
// @ts-expect-error removed
api.progress.bar({ total: 1, color: "cyan" });
// @ts-expect-error removed
api.progress.spinner({ color: "cyan" });
// @ts-expect-error removed
api.table([["a"]], { borderColor: "cyan" });
// @ts-expect-error removed
api.progress.multi({ stderr: process.stderr }).add({ total: 1, stderr: process.stderr });
void [oldCode, oldParse, oldCancel];
