import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PromptCancelError } from "../src/errors.js";
import type { Choice, PromptBaseOptions, SelectChoice, TextOptions } from "../src/index.js";

function createPromptStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { stdin, stdout, getOutput: () => output };
}

function feedLines(stdin: PassThrough, lines: string[]): void {
  lines.forEach((line, index) => {
    setTimeout(() => {
      stdin.write(`${line}\n`);
      if (index === lines.length - 1) {
        stdin.end();
      }
    }, index * 10);
  });
}

describe("prompt", () => {
  it("exports prompt functions", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    expect(prompt.text).toBeTypeOf("function");
    expect(prompt.confirm).toBeTypeOf("function");
    expect(prompt.select).toBeTypeOf("function");
    expect(prompt.multiselect).toBeTypeOf("function");
    expect(prompt.password).toBeTypeOf("function");
  });

  it("PromptCancelError has correct code", () => {
    const err = new PromptCancelError();
    expect(err.code).toBe("PROMPT_CANCELLED");
    expect(err.name).toBe("PromptCancelError");
    expect(err.message).toBe("Prompt cancelled");
  });

  it("exports prompt option and choice types", () => {
    const base: PromptBaseOptions = { required: false };
    const text: TextOptions = { ...base, placeholder: "name" };
    const choice: SelectChoice<string> = { label: "One", value: "one" };
    const choices: Choice<string>[] = [choice, "two"];

    expect(text.placeholder).toBe("name");
    expect(choices).toHaveLength(2);
  });

  it("renders text placeholder when no default is set", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.text("Name", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      required: false,
      placeholder: "Jane",
    });
    streams.stdin.end("\n");

    await expect(promise).resolves.toBe("");
    expect(streams.getOutput()).toContain("Jane");
  });

  it("re-prompts text until validation succeeds", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.text("Token", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      validate(value) {
        if (value !== "valid") throw new Error("bad token");
      },
    });
    feedLines(streams.stdin, ["bad", "valid"]);

    await expect(promise).resolves.toBe("valid");
    expect(streams.getOutput()).toContain("bad token");
  });

  it("uses confirm defaults and accepts yes/no input", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const first = createPromptStreams();
    const second = createPromptStreams();

    const defaulted = prompt.confirm("Continue?", {
      stdin: first.stdin,
      stdout: first.stdout,
      default: true,
    });
    first.stdin.end("\n");

    const explicitNo = prompt.confirm("Continue?", {
      stdin: second.stdin,
      stdout: second.stdout,
      default: true,
    });
    second.stdin.end("no\n");

    await expect(defaulted).resolves.toBe(true);
    await expect(explicitNo).resolves.toBe(false);
  });

  it("select accepts labels after rejecting invalid input", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.select(
      "Env",
      [
        { label: "Production", value: "prod", hint: "live" },
        { label: "Staging", value: "staging" },
      ],
      { stdin: streams.stdin, stdout: streams.stdout },
    );
    feedLines(streams.stdin, ["9", "staging"]);

    await expect(promise).resolves.toBe("staging");
    expect(streams.getOutput()).toContain("Please enter a number between 1 and 2");
  });

  it("multiselect enforces min and max before returning selected values", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.multiselect("Pick", ["a", "b", "c"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
      min: 2,
      max: 2,
    });
    feedLines(streams.stdin, ["1", "1,2,3", "1,3"]);

    await expect(promise).resolves.toEqual(["a", "c"]);
    expect(streams.getOutput()).toContain("Select at least 2 items");
    expect(streams.getOutput()).toContain("Select at most 2 items");
  });

  it("password resolves input and does not write the password in clear text", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("secret\n");

    await expect(promise).resolves.toBe("secret");
    expect(streams.getOutput()).not.toContain("secret");
  });
});
