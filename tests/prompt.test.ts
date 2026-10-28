import type { Readable, Writable } from "node:stream";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PromptCancelError } from "../src/errors.js";
import type { Choice, PromptBaseOptions, SelectChoice, TextOptions } from "../src/index.js";
import { resetColorEnabled } from "../src/output/color.js";
import { createMockStdin, createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

function createPromptStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { stdin, stdout, getOutput: () => output };
}

/** Delivers every line in one chunk followed by EOF, the way a pipe does. */
function feedLines(stdin: PassThrough, lines: string[]): void {
  stdin.end(lines.map((line) => `${line}\n`).join(""));
}

describe("prompt", () => {
  restoreProcessStateAfterEach(["NO_COLOR", "FORCE_COLOR"]);

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

  it("does not emit ANSI color when a custom stdout is non-TTY", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    resetColorEnabled();
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    try {
      const promise = prompt.text("Name", {
        stdin: streams.stdin,
        stdout: streams.stdout,
        required: false,
      });
      streams.stdin.end("\n");

      await expect(promise).resolves.toBe("");
      expect(streams.getOutput()).not.toContain("\x1b[32m");
      expect(streams.getOutput()).not.toContain("\x1b[1m");
      expect(streams.getOutput()).not.toContain("\x1b[");
    } finally {
      resetColorEnabled();
    }
  });

  it("does not echo scripted input or terminal controls to non-TTY output", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.text("Name", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("Alice\n");

    await expect(promise).resolves.toBe("Alice");
    expect(streams.getOutput()).not.toContain("Alice");
    expect(streams.getOutput()).not.toContain("\x1b[");
  });

  it("rejects a pending prompt when its AbortSignal is aborted", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const controller = new AbortController();
    const pending = prompt.text("Name", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("rejects concurrent prompts reading from the same input", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const controller = new AbortController();
    const first = prompt.text("First", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      signal: controller.signal,
    });
    await expect(
      prompt.text("Second", { stdin: streams.stdin, stdout: streams.stdout }),
    ).rejects.toThrow("already reading");
    controller.abort();
    await expect(first).rejects.toBeInstanceOf(PromptCancelError);
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

  it("re-prompts confirm for unknown input without discarding its default", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const confirmation = prompt.confirm("Continue?", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      default: true,
    });
    feedLines(streams.stdin, ["perhaps", ""]);

    await expect(confirmation).resolves.toBe(true);
    expect(streams.getOutput()).toContain("Please enter yes or no");
  });

  it("applies confirm validation and re-prompts", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.confirm("Continue?", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      validate(value) {
        if (!value) throw new Error("confirmation required");
      },
    });
    feedLines(streams.stdin, ["no", "yes"]);
    await expect(promise).resolves.toBe(true);
    expect(streams.getOutput()).toContain("confirmation required");
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

  it("rejects a label-only object instead of returning undefined", async () => {
    const { prompt } = await import("../src/output/prompt.js");

    await expect(
      prompt.select<{ label: string }>("Pick", [{ label: "Not a descriptor" }]),
    ).rejects.toThrow(/both label and value/);
  });

  it("returns a descriptor's value when both label and value are present", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.select("Pick", [{ label: "One", value: 1 }], {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("1\n");

    await expect(promise).resolves.toBe(1);
  });

  it("re-prompts select and multiselect when their validators reject", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const selectStreams = createPromptStreams();
    const selected = prompt.select("Pick", ["a", "b"], {
      stdin: selectStreams.stdin,
      stdout: selectStreams.stdout,
      validate(value) {
        if (value !== "b") throw new Error("pick b");
      },
    });
    feedLines(selectStreams.stdin, ["1", "2"]);
    await expect(selected).resolves.toBe("b");
    expect(selectStreams.getOutput()).toContain("pick b");

    const multiStreams = createPromptStreams();
    const selectedMany = prompt.multiselect("Pick", ["a", "b"], {
      stdin: multiStreams.stdin,
      stdout: multiStreams.stdout,
      validate(values) {
        if ((values as string[]).length !== 2) throw new Error("pick both");
      },
    });
    feedLines(multiStreams.stdin, ["1", "1,2"]);
    await expect(selectedMany).resolves.toEqual(["a", "b"]);
    expect(multiStreams.getOutput()).toContain("pick both");
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

  it.each([
    { min: -1 },
    { max: -1 },
    { min: 3 },
    { min: 2, max: 1 },
    { min: Number.POSITIVE_INFINITY },
  ])("multiselect rejects impossible bounds before reading input: %j", async (bounds) => {
    const { prompt } = await import("../src/output/prompt.js");
    await expect(prompt.multiselect("Pick", ["a", "b"], bounds)).rejects.toBeInstanceOf(RangeError);
  });

  it("sanitizes terminal controls in choice labels and hints", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.select(
      "Pick",
      [{ label: "safe\x1b[2J", hint: "hint\x1b]2;title\x07", value: "ok" }],
      { stdin: streams.stdin, stdout: streams.stdout },
    );
    streams.stdin.end("1\n");

    await expect(promise).resolves.toBe("ok");
    expect(streams.getOutput()).not.toContain("\x1b[2J");
    expect(streams.getOutput()).not.toContain("\x1b]2;");
  });

  it("multiselect rejects partially numeric tokens", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.multiselect("Pick", ["a", "b", "c"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    feedLines(streams.stdin, ["1,2x", "1,2"]);

    await expect(promise).resolves.toEqual(["a", "b"]);
    expect(streams.getOutput()).toContain("Please enter valid numbers");
  });

  it("multiselect allows zero selections when min is unset", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.multiselect("Pick", ["a", "b"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
      default: [],
    });
    streams.stdin.end("\n");
    await expect(promise).resolves.toEqual([]);
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

  it("masks password input from a TTY even when stdout is redirected", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutText = "";
    let stderrText = "";
    stdout.on("data", (chunk) => {
      stdoutText += chunk.toString();
    });
    stderr.on("data", (chunk) => {
      stderrText += chunk.toString();
    });
    (stdin as unknown as { isTTY: boolean }).isTTY = true;
    (stderr as unknown as { isTTY: boolean; columns: number; rows: number }).isTTY = true;
    (stderr as unknown as { columns: number }).columns = 80;
    (stderr as unknown as { rows: number }).rows = 24;

    const result = prompt.password("Password", { stdin, stdout, stderr });
    stdin.end("secret\n");

    await expect(result).resolves.toBe("secret");
    expect(stdoutText).not.toContain("Password");
    expect(stdoutText).not.toContain("secret");
    expect(stderrText).toContain("Password");
    expect(stderrText).not.toContain("secret");
  });

  it("never treats prompt text inside a password as a trusted redraw prefix", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    (streams.stdin as unknown as { isTTY: boolean }).isTTY = true;
    (streams.stdout as unknown as { isTTY: boolean; columns: number }).isTTY = true;
    (streams.stdout as unknown as { columns: number }).columns = 80;
    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    await vi.waitFor(() => expect(streams.getOutput()).toContain("Password"));
    streams.stdin.write("abc? Password xyz");
    streams.stdin.end("\x7f\n");

    await expect(promise).resolves.toBe("abc? Password xy");
    expect(streams.getOutput()).not.toContain("abc? Password");
  });

  it("password preserves leading and trailing whitespace", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("  secret  \n");
    await expect(promise).resolves.toBe("  secret  ");
  });

  it("re-prompts password for required and validation failures", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const password = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      validate(value) {
        if (value !== "secret") throw new Error("invalid password");
      },
    });
    feedLines(streams.stdin, ["", "wrong", "secret"]);

    await expect(password).resolves.toBe("secret");
    expect(streams.getOutput()).toContain("Value is required");
    expect(streams.getOutput()).toContain("invalid password");
  });

  it("password renders the prompt as readline query while masking typed input", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("s\n");

    await expect(promise).resolves.toBe("s");
    expect(streams.getOutput()).toContain("Password");
    expect(streams.getOutput()).not.toContain("s\n");
  });

  it("password masks wide and multi-code-point graphemes with one asterisk", async () => {
    const { maskInput } = await import("../src/output/prompt.js");
    expect(maskInput("界")).toBe("*");
    expect(maskInput("👍🏽")).toBe("*");
    expect(maskInput("e\u0301")).toBe("*");
    expect(maskInput("👨‍👩‍👧‍👦")).toBe("*");
  });

  it("password does not replace the output stream's write reference", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const originalWrite = streams.stdout.write;

    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.end("secret\n");

    await expect(promise).resolves.toBe("secret");
    expect(streams.stdout.write).toBe(originalWrite);
  });

  it("two sequential password prompts work and leave the stream write intact", async () => {
    const { prompt } = await import("../src/output/prompt.js");

    const first = createPromptStreams();
    const originalWrite = first.stdout.write;
    const p1 = prompt.password("First", { stdin: first.stdin, stdout: first.stdout });
    first.stdin.end("alpha\n");
    await expect(p1).resolves.toBe("alpha");
    expect(first.stdout.write).toBe(originalWrite);

    const second = createPromptStreams();
    const secondOriginalWrite = second.stdout.write;
    const p2 = prompt.password("Second", { stdin: second.stdin, stdout: second.stdout });
    second.stdin.end("beta\n");
    await expect(p2).resolves.toBe("beta");
    expect(second.stdout.write).toBe(secondOriginalWrite);
    expect(first.getOutput()).not.toContain("alpha");
    expect(second.getOutput()).not.toContain("beta");
  });

  it("answers sequential prompts from lines that arrived in one chunk", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const io = { stdin: streams.stdin, stdout: streams.stdout };
    streams.stdin.end("a\ny\n1\nsecret\n1,2\n");

    const answers = [
      await prompt.text("Name", io),
      await prompt.confirm("Sure?", io),
      await prompt.select("Env", ["prod", "dev"], io),
      await prompt.password("Password", io),
      await prompt.multiselect("Pick", ["a", "b"], io),
    ];

    expect(answers).toEqual(["a", true, "prod", "secret", ["a", "b"]]);
    await expect(prompt.text("More", io)).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("keeps unanswered lines for the next prompt after the input ends", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const io = { stdin: streams.stdin, stdout: streams.stdout };
    const first = prompt.text("First", io);
    streams.stdin.write("one\ntwo\n");
    await expect(first).resolves.toBe("one");
    // EOF arrives between prompts; the queued line still answers.
    streams.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(prompt.text("Second", io)).resolves.toBe("two");
  });

  it("sanitizes text defaults, placeholders and styled choice labels", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const { closeAnsiState } = await import("../src/output/color.js");

    const withDefault = createPromptStreams();
    const a = prompt.text("Name", {
      stdin: withDefault.stdin,
      stdout: withDefault.stdout,
      default: "x\x1b[2J\x1b]0;title\x07",
    });
    withDefault.stdin.end("\n");
    await expect(a).resolves.toBe("x\x1b[2J\x1b]0;title\x07");
    expect(withDefault.getOutput()).not.toContain("\x1b[2J");
    expect(withDefault.getOutput()).not.toContain("\x1b]0;");

    const withPlaceholder = createPromptStreams();
    const b = prompt.text("Name", {
      stdin: withPlaceholder.stdin,
      stdout: withPlaceholder.stdout,
      required: false,
      placeholder: "p\x1b]0;title\x07\x1b[H",
    });
    withPlaceholder.stdin.end("\n");
    await expect(b).resolves.toBe("");
    expect(withPlaceholder.getOutput()).not.toContain("\x1b]0;");
    expect(withPlaceholder.getOutput()).not.toContain("\x1b[H");

    const styled = createPromptStreams();
    const c = prompt.select(
      "Pick",
      [
        { label: "\x1b[31mRed", hint: "\x1b[4mhint", value: "red" },
        { label: "Blue", value: "blue" },
      ],
      { stdin: styled.stdin, stdout: styled.stdout },
    );
    styled.stdin.end("red\n");
    await expect(c).resolves.toBe("red");
    for (const line of styled.getOutput().split("\n")) {
      // Nothing a label or hint opened is still open at the end of its row.
      expect(closeAnsiState(line)).toBe(line);
    }
  });

  it("clears and redraws an active progress region around prompt lines", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const { setRegionOwner } = await import("../src/output/region.js");
    const streams = createPromptStreams();
    let redraws = 0;
    setRegionOwner(streams.stdout, {
      clear: () => "<clear>",
      redraw: () => {
        redraws++;
      },
    });
    try {
      const chosen = prompt.select("Env", ["prod", "dev"], {
        stdin: streams.stdin,
        stdout: streams.stdout,
      });
      feedLines(streams.stdin, ["9", "2"]);
      await expect(chosen).resolves.toBe("dev");
    } finally {
      setRegionOwner(streams.stdout, null);
    }
    const output = streams.getOutput();
    expect(output).toContain("<clear>? Env");
    expect(output).toContain("<clear>  1) prod");
    expect(output).toContain("<clear>  2) dev");
    expect(output).toContain("<clear>✖ Please enter a number");
    expect(redraws).toBe(4);
  });

  it("text rejects with PromptCancelError on EOF", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.text("Name", { stdin: streams.stdin, stdout: streams.stdout });
    streams.stdin.push(null);

    await expect(promise).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("confirm rejects with PromptCancelError on EOF", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.confirm("Continue?", { stdin: streams.stdin, stdout: streams.stdout });
    streams.stdin.push(null);

    await expect(promise).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("select rejects with PromptCancelError on EOF", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.select("Env", ["a", "b"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.push(null);

    await expect(promise).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("multiselect rejects with PromptCancelError on EOF", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.multiselect("Pick", ["a", "b"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.push(null);

    await expect(promise).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("password rejects with PromptCancelError on EOF", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    streams.stdin.push(null);

    await expect(promise).rejects.toBeInstanceOf(PromptCancelError);
  });

  it("text with an empty-string default resolves immediately on Enter", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.text("Name", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      default: "",
    });
    streams.stdin.end("\n");

    await expect(promise).resolves.toBe("");
  });

  it("allows text whitespace trimming to be disabled", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const value = prompt.text("Name", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      trim: false,
    });
    streams.stdin.end("  Ada  \n");

    await expect(value).resolves.toBe("  Ada  ");
  });

  it("trims password whitespace only when requested", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();
    const value = prompt.password("Password", {
      stdin: streams.stdin,
      stdout: streams.stdout,
      trim: true,
    });
    streams.stdin.end("  secret  \n");

    await expect(value).resolves.toBe("secret");
  });

  it("select is selectable by index when a choice has a numeric label", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const promise = prompt.select("Pick", ["10", "20"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
    });
    feedLines(streams.stdin, ["2"]);

    await expect(promise).resolves.toBe("20");
  });

  it("select honors an object-valued default", async () => {
    const { prompt } = await import("../src/output/prompt.js");
    const streams = createPromptStreams();

    const optA = { id: "a" };
    const optB = { id: "b" };
    const promise = prompt.select(
      "Pick",
      [
        { label: "A", value: optA },
        { label: "B", value: optB },
      ],
      { stdin: streams.stdin, stdout: streams.stdout, default: optB },
    );
    streams.stdin.end("\n");

    await expect(promise).resolves.toBe(optB);
    expect(streams.getOutput()).toContain("[default]");
  });

  it("maskInput masks emoji by character count rather than visible width", async () => {
    const { maskInput } = await import("../src/output/prompt.js");

    const input = "a😀b";
    const masked = maskInput(input);
    expect(masked).toBe("***");
    expect(masked).not.toContain("a");
    expect(masked).not.toContain("b");
    expect(masked).not.toContain("😀");
  });

  it("maskInput passes OSC sequences through untouched", async () => {
    const { maskInput } = await import("../src/output/prompt.js");

    // An OSC sequence (ESC ] ... BEL) carries no echoed user input, so it must
    // pass through verbatim — masking its bytes would corrupt the terminal and
    // misreport width. Only the trailing visible text is masked.
    const osc = `${String.fromCharCode(27)}]0;window-title${String.fromCharCode(7)}`;
    expect(maskInput(`${osc}secret`)).toBe(`${osc}******`);
  });
});

describe("terminal state is handled the same way by every prompt kind", () => {
  type Start = (stdin: Readable, stdout: Writable, signal?: AbortSignal) => Promise<unknown>;

  const kinds: Record<string, Start> = {
    text: async (stdin, stdout, signal) => (await load()).text("name", { stdin, stdout, signal }),
    confirm: async (stdin, stdout, signal) =>
      (await load()).confirm("ok?", { stdin, stdout, signal }),
    select: async (stdin, stdout, signal) =>
      (await load()).select("pick", ["a", "b"], { stdin, stdout, signal }),
    multiselect: async (stdin, stdout, signal) =>
      (await load()).multiselect("pick", ["a", "b"], { stdin, stdout, signal }),
    password: async (stdin, stdout, signal) =>
      (await load()).password("secret", { stdin, stdout, signal }),
  };

  async function load() {
    return (await import("../src/output/prompt.js")).prompt;
  }

  it.each(Object.keys(kinds))("releases the input lock after an abort: %s", async (name) => {
    const start = kinds[name];
    const stdin = createMockStdin();
    const stdout = createMockStdout();
    const controller = new AbortController();

    const aborted = start(stdin, stdout, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(PromptCancelError);

    // The lock is per call, so the same stream must be usable immediately.
    const second = start(stdin, stdout);
    // Input each kind accepts: a bare word for text/password, a yes for
    // confirm, an index for the two list prompts.
    stdin.feed(name === "confirm" ? "y\n" : name === "text" || name === "password" ? "a\n" : "1\n");
    await expect(second).resolves.toBeDefined();
  });

  it.each(Object.keys(kinds))("rejects when input was already destroyed: %s", async (name) => {
    const stdin = createMockStdin();
    stdin.destroy();

    await expect(kinds[name](stdin, createMockStdout())).rejects.toBeInstanceOf(PromptCancelError);
  });

  it.each(Object.keys(kinds))("rejects when input is destroyed while pending: %s", async (name) => {
    const stdin = createMockStdin();
    const stdout = createMockStdout();
    const pending = kinds[name](stdin, stdout);
    await vi.waitFor(() => expect(stdout.getOutput()).not.toBe(""));
    stdin.destroy();

    await expect(pending).rejects.toBeInstanceOf(PromptCancelError);
  });

  it.each(Object.keys(kinds))("rejects when input errors while pending: %s", async (name) => {
    const stdin = createMockStdin();
    const stdout = createMockStdout();
    const pending = kinds[name](stdin, stdout);
    await vi.waitFor(() => expect(stdout.getOutput()).not.toBe(""));
    stdin.destroy(new Error("EIO"));

    await expect(pending).rejects.toBeInstanceOf(PromptCancelError);
    await vi.waitFor(() => expect(stdin.closed).toBe(true));
    expect(stdin.listenerCount("error")).toBe(0);
  });

  it.each(Object.keys(kinds))("rejects when input already ended: %s", async (name) => {
    const stdin = createMockStdin();
    stdin.push(null);
    await new Promise((resolve) => stdin.once("end", resolve).resume());

    await expect(kinds[name](stdin, createMockStdout())).rejects.toBeInstanceOf(PromptCancelError);
  });
});
