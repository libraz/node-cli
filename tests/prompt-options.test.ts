import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { prompt } from "../src/index.js";

function streams() {
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { stdin, stderr, out: () => output };
}

function feed(stdin: PassThrough, lines: string[]): void {
  stdin.end(lines.map((l) => `${l}\n`).join(""));
}

const bad = (v: unknown) => v as never;
const choices = ["a", "b", "c"];

describe("prompt option validation", () => {
  const cases: [string, (o: object) => Promise<unknown>, string, unknown][] = [
    ["text default", (o) => prompt.text("q", o), "default", 5],
    ["text trim", (o) => prompt.text("q", o), "trim", "no"],
    ["text required", (o) => prompt.text("q", o), "required", "false"],
    ["text placeholder", (o) => prompt.text("q", o), "placeholder", 5],
    ["text marker", (o) => prompt.text("q", o), "marker", 5],
    ["text stdin", (o) => prompt.text("q", o), "stdin", {}],
    ["text stderr", (o) => prompt.text("q", o), "stderr", {}],
    ["text signal", (o) => prompt.text("q", o), "signal", "x"],
    ["confirm marker", (o) => prompt.confirm("q", o), "marker", 5],
    ["confirm stderr", (o) => prompt.confirm("q", o), "stderr", {}],
    ["select marker", (o) => prompt.select("q", choices, o), "marker", 5],
    ["select signal", (o) => prompt.select("q", choices, o), "signal", {}],
    ["multiselect default", (o) => prompt.multiselect("q", choices, o), "default", "a"],
    ["multiselect stdin", (o) => prompt.multiselect("q", choices, o), "stdin", 1],
    ["password trim", (o) => prompt.password("q", o), "trim", "x"],
    ["password required", (o) => prompt.password("q", o), "required", 0],
    ["password stderr", (o) => prompt.password("q", o), "stderr", {}],
  ];

  for (const [label, run, key, value] of cases) {
    it(`${label} is a TypeError naming the API`, async () => {
      const fn = label.split(" ")[0];
      const err = await run({ [key]: value }).catch((e) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect(err.message).toContain(`prompt.${fn}()`);
      expect(err.message).toContain(`"${key}"`);
      expect(err.message).not.toContain("sanitizeTerminalText");
    });
  }

  it("rejects null and array options", async () => {
    for (const o of [null, []]) {
      const err = await prompt.text("q", bad(o)).catch((e) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect(err.message).toContain("prompt.text()");
    }
  });

  it("rejects a non-string choice hint", async () => {
    const err = await prompt
      .select("q", [{ label: "a", value: "a", hint: bad(5) }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    expect(err.message).toContain("prompt.select()");
    expect(err.message).not.toContain("sanitizeTerminalText");
  });

  it("writes nothing before rejecting", async () => {
    const s = streams();
    await prompt.text("q", { stdin: s.stdin, stderr: s.stderr, trim: bad("no") }).catch(() => {});
    expect(s.out()).toBe("");
  });

  it("accepts stdin null as no input", async () => {
    const s = streams();
    const err = await prompt.text("q", { stdin: null, stderr: s.stderr }).catch((e) => e);
    expect(err).toHaveProperty("name", "InputEndedError");
  });

  it("accepts a valid AbortSignal and explicit undefined members", async () => {
    const s = streams();
    const p = prompt.text("q", {
      stdin: s.stdin,
      stderr: s.stderr,
      signal: new AbortController().signal,
      trim: undefined,
      default: undefined,
    });
    feed(s.stdin, ["hi"]);
    await expect(p).resolves.toBe("hi");
  });
});

describe("multiselect bounds", () => {
  it("non-number min/max is a TypeError", async () => {
    for (const key of ["min", "max"]) {
      for (const v of ["2", null, true]) {
        const err = await prompt.multiselect("q", choices, { [key]: v } as never).catch((e) => e);
        expect(err).toBeInstanceOf(TypeError);
        expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
        expect(err.message).toContain("prompt.multiselect()");
      }
    }
  });

  it("negative or non-integer min/max stays a RangeError", async () => {
    for (const v of [-1, 1.5, Number.NaN]) {
      const err = await prompt.multiselect("q", choices, { min: v }).catch((e) => e);
      expect(err).toBeInstanceOf(RangeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
    }
  });

  it("rejects a default whose distinct count is outside min..max before asking", async () => {
    const s = streams();
    const base = { stdin: s.stdin, stderr: s.stderr };
    for (const opts of [
      { default: ["a", "b"], max: 1 },
      { default: ["a"], min: 2 },
      { default: ["a", "a"], min: 2 },
    ]) {
      const err = await prompt.multiselect("q", choices, { ...base, ...opts }).catch((e) => e);
      expect(err).toBeInstanceOf(RangeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
    }
    expect(s.out()).toBe("");
  });

  it("counts duplicate defaults once", async () => {
    const s = streams();
    const p = prompt.multiselect("q", choices, {
      stdin: s.stdin,
      stderr: s.stderr,
      default: ["a", "a"],
      max: 1,
    });
    feed(s.stdin, [""]);
    await expect(p).resolves.toEqual(["a"]);
  });

  it("returns defaults in choice order on an empty answer", async () => {
    const s = streams();
    const p = prompt.multiselect("q", choices, {
      stdin: s.stdin,
      stderr: s.stderr,
      default: ["c", "a"],
    });
    feed(s.stdin, [""]);
    await expect(p).resolves.toEqual(["a", "c"]);
  });

  it("uses singular wording for 1 and plural otherwise", async () => {
    const s = streams();
    const p = prompt.multiselect("q", choices, {
      stdin: s.stdin,
      stderr: s.stderr,
      min: 1,
      max: 1,
    });
    feed(s.stdin, ["1,2", "1"]);
    await p;
    expect(s.out()).toContain("Select at most 1 item\n");

    const s2 = streams();
    const p2 = prompt.multiselect("q", choices, { stdin: s2.stdin, stderr: s2.stderr, min: 1 });
    feed(s2.stdin, ["", "1"]);
    await p2;
    expect(s2.out()).toContain("Select at least 1 item\n");

    const s3 = streams();
    const p3 = prompt.multiselect("q", choices, {
      stdin: s3.stdin,
      stderr: s3.stderr,
      min: 2,
      max: 2,
    });
    feed(s3.stdin, ["1", "1,2,3", "1,2"]);
    await p3;
    expect(s3.out()).toContain("Select at least 2 items");
    expect(s3.out()).toContain("Select at most 2 items");
  });
});

describe("select re-ask wording", () => {
  it("names the number range and the label alternative", async () => {
    const s = streams();
    const p = prompt.select("q", choices, { stdin: s.stdin, stderr: s.stderr });
    feed(s.stdin, ["9", "b"]);
    await expect(p).resolves.toBe("b");
    expect(s.out()).toContain("Please enter a number between 1 and 3, or a choice label");
  });
});

describe("prompt TSDoc", () => {
  const src = readFileSync(new URL("../src/output/prompt.ts", import.meta.url), "utf8");
  const doc = (member: string): string => {
    const i = src.indexOf(member);
    const start = src.lastIndexOf("/**", i);
    return src.slice(start, i);
  };

  it("MultiselectOptions.min states its default", () => {
    expect(doc("min?: number")).toContain("Defaults to");
  });

  it("TextOptions.default mentions required", () => {
    expect(doc("default?: string | undefined")).toContain("required");
  });

  it("the other optional members state a default", () => {
    expect(doc("max?: number")).toContain("Defaults to");
    expect(doc("hint?: string")).toContain("Defaults to");
    expect(doc("validate?:")).toContain("Defaults to");
  });
});
