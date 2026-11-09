import {
  type ConfirmOptions,
  type MultiselectOptions,
  type PasswordOptions,
  type PromptOptions,
  prompt,
  type SelectChoice,
  type SelectOptions,
  type TextOptions,
} from "../../dist/index.js";

declare const text: string | undefined;
declare const flag: boolean | undefined;
declare const count: number | undefined;
declare const validate: ((value: string) => void) | undefined;

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into optional members.
const shared: PromptOptions<string> = { marker: text, validate };
const textOptions: TextOptions = {
  ...shared,
  default: text,
  placeholder: text,
  trim: flag,
  required: flag,
};
const passwordOptions: PasswordOptions = { ...shared, trim: flag, required: flag };
const confirmOptions: ConfirmOptions = { default: flag, marker: text };
const selectOptions: SelectOptions<string> = { default: text, marker: text };
const multiselectOptions: MultiselectOptions<string> = {
  default: undefined,
  min: count,
  max: count,
};
const choice: SelectChoice<string> = { label: "One", value: "one", hint: text };

void prompt.text("Name?", textOptions);
void prompt.password("Token:", passwordOptions);
void prompt.confirm("Sure?", confirmOptions);
void prompt.select("Env:", [choice, "two"], selectOptions);
void prompt.multiselect<string>("Pick:", ["a", "b"], multiselectOptions);
