import type { PasswordOptions } from "../src/index.js";

const passwordOptions: PasswordOptions = { required: false };

// @ts-expect-error Password prompts intentionally do not accept default secrets.
const passwordOptionsWithDefault: PasswordOptions = { default: "secret" };

void passwordOptions;
void passwordOptionsWithDefault;
