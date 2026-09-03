import type { PasswordOptions, TextOptions } from "../src/index.js";

const passwordOptions: PasswordOptions = { required: false };

// @ts-expect-error Password prompts intentionally do not accept default secrets.
const passwordOptionsWithDefault: PasswordOptions = { default: "secret" };

// Only the password prompt redirects away from a captured stdout, so `stderr`
// must not be reachable from the other prompt kinds.
const passwordOptionsWithStderr: PasswordOptions = { stderr: process.stderr };

// @ts-expect-error Only password prompts redirect to stderr.
const textOptionsWithStderr: TextOptions = { stderr: process.stderr };

void passwordOptions;
void passwordOptionsWithDefault;
void passwordOptionsWithStderr;
void textOptionsWithStderr;
