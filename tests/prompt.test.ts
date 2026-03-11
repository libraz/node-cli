import { describe, expect, it } from "vitest";
import { PromptCancelError } from "../src/errors.js";

// Prompt functions require TTY, so we test the error class
// and basic imports. Full interactive testing requires a PTY.

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
});
