import type {
  ColorFn,
  CommandBuilder,
  CommandContext,
  ConfirmOptions,
  ModeConfig,
  MultiselectOptions,
  PasswordOptions,
  SelectOptions,
  TextOptions,
} from "../src/index.js";
import { color, createLogger, progress, prompt } from "../src/index.js";

const passwordOptions: PasswordOptions = { required: false };

// @ts-expect-error Password prompts intentionally do not accept default secrets.
const passwordOptionsWithDefault: PasswordOptions = { default: "secret" };

// Every prompt kind asks on stderr and reads from stdin; stdout is not an option.
const passwordOptionsWithStderr: PasswordOptions = { stderr: process.stderr };
const textOptionsWithStderr: TextOptions = { stderr: process.stderr };

// @ts-expect-error Prompts have no stdout option; pass `stderr: process.stdout` to ask there.
const textOptionsWithStdout: TextOptions = { stdout: process.stdout };

// The style functions in public signatures are nameable from the package root.
const red: ColorFn = color.red;
const boldRed: ColorFn = red.bold;
const styled: string = boldRed("text");

// Each prompt's validator receives the value type that prompt resolves to.
const textValidate: TextOptions = { validate: (value: string) => void value };
// @ts-expect-error A text validator receives a string.
const textValidateWrong: TextOptions = { validate: (value: number) => void value };
const passwordValidate: PasswordOptions = { validate: (value: string) => void value };
// @ts-expect-error A password validator receives a string.
const passwordValidateWrong: PasswordOptions = { validate: (value: number) => void value };
const confirmValidate: ConfirmOptions = { validate: (value: boolean) => void value };
// @ts-expect-error A confirm validator receives a boolean.
const confirmValidateWrong: ConfirmOptions = { validate: (value: string) => void value };
const selectValidate: SelectOptions<number> = {
  validate: (value: number) => void value,
};
const selectValidateWrong: SelectOptions<number> = {
  // @ts-expect-error A select validator receives the choice value type.
  validate: (value: string) => void value,
};
const multiselectValidate: MultiselectOptions<number> = {
  validate: (value: number[]) => void value,
};
const multiselectValidateWrong: MultiselectOptions<number> = {
  // @ts-expect-error A multiselect validator receives an array of choice values.
  validate: (value: string) => void value,
};

// A mode action's streams are accepted by every output API.
const mode: ModeConfig = {
  prompt: "> ",
  action: async (_input, mctx) => {
    createLogger({ stream: mctx.stderr }).info("ok");
    progress.spinner({ stream: mctx.stderr }).stop();
    await prompt.text("name", { stderr: mctx.stderr });
  },
};

// The shell's lifecycle and the builder's constructor are not part of the public surface.
function useShell(ctx: CommandContext): void {
  ctx.shell?.enterMode(mode);
  // @ts-expect-error start() is driven by the CLI, not by command actions.
  void ctx.shell?.start();
}
// @ts-expect-error CommandBuilder is a type; builders come from cli.command().
const builder: CommandBuilder = new CommandBuilder();

void passwordOptions;
void useShell;
void builder;
void textValidate;
void textValidateWrong;
void passwordValidate;
void passwordValidateWrong;
void confirmValidate;
void confirmValidateWrong;
void selectValidate;
void selectValidateWrong;
void multiselectValidate;
void multiselectValidateWrong;
void passwordOptionsWithDefault;
void passwordOptionsWithStderr;
void textOptionsWithStderr;
void textOptionsWithStdout;
void styled;
