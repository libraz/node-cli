import type { Readable, Writable } from "node:stream";
import {
  type CommandContext,
  type ConfirmOptions,
  type MultiselectOptions,
  type PasswordOptions,
  type PromptOptions,
  prompt,
  type SelectOptions,
  type StdioOptions,
  type TextOptions,
} from "../../src/index.js";

declare const ctx: CommandContext;
declare const stderr: Writable;
declare const stdin: Readable;

// A command context is accepted as the options object: extra members such as
// stdout are not part of the prompt options.
void prompt.text("Name?", ctx);
void prompt.confirm("Sure?", ctx);
void prompt.select("Env:", ["dev", "prod"], ctx);
void prompt.multiselect("Pick:", ["a", "b"], ctx);
void prompt.password("Token:", ctx);

// Stdio options are accepted too, and stdin may be null.
const stdio: StdioOptions = { stdin: null, stderr };
void prompt.text("Name?", stdio);
void prompt.text("Name?", { stdin, stderr, marker: ">", required: false });

// PromptOptions is the shared shape; validate may be async.
const shared: PromptOptions<string> = {
  marker: "?",
  validate: async (value) => {
    if (value === "") throw new Error("empty");
  },
};
void shared;
const syncValidate: PromptOptions<number> = { validate: (value) => void value.toFixed() };
void syncValidate;

// Choices and defaults accept readonly arrays.
const envs = ["dev", "prod"] as const;
void prompt.select("Env:", envs, { default: "dev" });
const many: MultiselectOptions<(typeof envs)[number]> = { default: envs, min: 1 };
void prompt.multiselect("Pick:", envs, many);

// required exists on text and password only.
const text: TextOptions = { required: false, placeholder: "x" };
const pass: PasswordOptions = { required: false };
void text;
void pass;

// @ts-expect-error prefix is now marker
const prefixed: TextOptions = { prefix: ">" };
void prefixed;

// @ts-expect-error the question stream is stderr; there is no stdout option
const withStdout: TextOptions = { stdout: stderr };
void withStdout;

// @ts-expect-error required is not an option of confirm
const confirmRequired: ConfirmOptions = { required: true };
void confirmRequired;

// @ts-expect-error required is not an option of select
const selectRequired: SelectOptions<string> = { required: true };
void selectRequired;

// @ts-expect-error required is not an option of multiselect
const multiRequired: MultiselectOptions<string> = { required: true };
void multiRequired;

// @ts-expect-error PromptBaseOptions is no longer exported
import type { PromptBaseOptions } from "../../src/index.js";

// @ts-expect-error maskInput is no longer part of the root
import { maskInput } from "../../src/index.js";

void maskInput;

export type { PromptBaseOptions };

// multiselect returns a readonly array and hands validate a readonly array.
async function multiselectReadonly(): Promise<void> {
  const picked = await prompt.multiselect("Pick:", ["a", "b"]);
  // @ts-expect-error the result is readonly
  picked.push("c");
  const validated: MultiselectOptions<string> = {
    validate: (values) => {
      // @ts-expect-error the validated array is readonly
      values.push("c");
    },
  };
  void validated;
}
void multiselectReadonly;

// select and multiselect infer literal unions without `as const`.
async function literalInference(): Promise<void> {
  const env = await prompt.select("Env:", ["dev", "prod"]);
  const typedEnv: "dev" | "prod" = env;
  void typedEnv;

  const modes = await prompt.multiselect("Modes:", ["a", "b"]);
  const typedModes: readonly ("a" | "b")[] = modes;
  void typedModes;

  const ports = await prompt.select("Port:", [80, 443]);
  const typedPort: 80 | 443 = ports;
  void typedPort;

  const described = await prompt.select("Env:", [
    { label: "Development", value: "dev" },
    { label: "Production", value: "prod" },
  ]);
  const typedDescribed: "dev" | "prod" = described;
  void typedDescribed;
}
void literalInference;

// A default must be one of the inferred choices.
// @ts-expect-error "stage" is not a choice
void prompt.select("Env:", ["dev", "prod"], { default: "stage" });
void prompt.select("Env:", ["dev", "prod"], { default: "prod" });
// @ts-expect-error "z" is not a choice
void prompt.multiselect("Pick:", ["a", "b"], { default: ["a", "z"] });
void prompt.multiselect("Pick:", ["a", "b"], { default: ["a"] });

// A value object that carries a `label` must be wrapped in a descriptor.
interface Labeled {
  label: string;
  id: number;
}
declare const labeled: Labeled;
// @ts-expect-error a bare value with a label member is not a descriptor
void prompt.select<Labeled>("Pick:", [labeled]);
void prompt.select<Labeled>("Pick:", [{ label: "Item", value: labeled }]);

// A value object without a label can be a bare choice.
interface Plain {
  id: number;
}
declare const plain: Plain;
void prompt.select<Plain>("Pick:", [plain]);

// Explicitly undefined optional members are accepted.
const explicitUndefined: SelectOptions<string> = { default: undefined, validate: undefined };
void explicitUndefined;
