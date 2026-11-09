import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  color,
  colorTag,
  createColorizer,
  createColorTag,
  isColorEnabled,
  setColorEnabled,
} from "../src/index.js";

const source = readFileSync(new URL("../src/output/color.ts", import.meta.url), "utf8");
const tsdoc = (source.match(/\/\*\*[\s\S]*?\*\//g) ?? []).join("\n");

/** The TSDoc block immediately preceding the first occurrence of `anchor`. */
function docBefore(anchor: string): string {
  const at = source.indexOf(anchor);
  expect(at).toBeGreaterThan(-1);
  const end = source.lastIndexOf("*/", at);
  const start = source.lastIndexOf("/**", end);
  return source.slice(start, end + 2);
}

function expectCoded(fn: () => unknown, type: ErrorConstructor, code: string, subject?: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(type);
  expect(caught).toHaveProperty("code", code);
  if (subject) expect((caught as Error).message).toContain(subject);
}

const badStreams: unknown[] = [
  undefined,
  null,
  0,
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1.5,
  true,
  "",
  "x",
  [],
  {},
  { write: "nope" },
  { isTTY: true },
];

afterEach(() => setColorEnabled("auto"));

describe("stream validation", () => {
  it.each(badStreams.map((v) => [String(v), v]))("createColorizer(%s) throws", (_n, value) => {
    expectCoded(
      () => createColorizer(value as never),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      "createColorizer()",
    );
  });

  it.each(badStreams.map((v) => [String(v), v]))("createColorTag(%s) throws", (_n, value) => {
    expectCoded(
      () => createColorTag(value as never),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      "createColorTag()",
    );
  });

  it.each(badStreams.filter((v) => v !== undefined).map((v) => [String(v), v]))(
    "isColorEnabled(%s) throws",
    (_n, value) => {
      expectCoded(
        () => isColorEnabled(value as never),
        TypeError,
        "ERR_INVALID_ARG_TYPE",
        "isColorEnabled()",
      );
    },
  );

  it("isColorEnabled() with no argument is accepted", () => {
    expect(typeof isColorEnabled()).toBe("boolean");
    expect(typeof isColorEnabled(undefined)).toBe("boolean");
  });

  it("validates even when an override is set", () => {
    setColorEnabled(true);
    expectCoded(() => isColorEnabled({} as never), TypeError, "ERR_INVALID_ARG_TYPE");
  });

  it("accepts an object with a write function", () => {
    const stream = { write: () => true, isTTY: true };
    setColorEnabled("auto");
    expect(() => createColorizer(stream as never)).not.toThrow();
    expect(() => createColorTag(stream as never)).not.toThrow();
    expect(() => isColorEnabled(stream as never)).not.toThrow();
  });
});

describe("ColorFn text", () => {
  const stream = { write: () => true, isTTY: true };
  const values: unknown[] = [undefined, null, 1, true, {}, []];

  for (const enabled of [true, false]) {
    describe(enabled ? "color on" : "color off", () => {
      it.each(values.map((v) => [String(v), v]))("rejects %s", (_n, value) => {
        setColorEnabled(enabled);
        const c = createColorizer(stream as never);
        for (const fn of [c.red, c.bold.red, color.green]) {
          let caught: unknown;
          try {
            (fn as (t: unknown) => string)(value);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(TypeError);
          expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
          expect((caught as Error).message).toContain(
            'The "text" argument of a Colorizer style function must be a string. Received',
          );
        }
      });

      it("accepts strings including the empty string", () => {
        setColorEnabled(enabled);
        expect(typeof color.red("")).toBe("string");
        expect(color.red("x")).toContain("x");
      });
    });
  }
});

describe("tag called as a function", () => {
  const stream = { write: () => true };
  const calls: [string, unknown[]][] = [
    ["no args", []],
    ["string", ["hello"]],
    ["number", [1]],
    ["array without raw", [["a"]]],
    ["null", [null]],
    ["object", [{ raw: ["a"] }]],
  ];

  it.each(calls)("colorTag(%s) throws", (_n, args) => {
    expectCoded(
      () => (colorTag as (...a: unknown[]) => string)(...args),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
  });

  it.each(calls)("ColorTag from createColorTag(%s) throws", (_n, args) => {
    const tag = createColorTag(stream as never) as (...a: unknown[]) => string;
    expectCoded(() => tag(...args), TypeError, "ERR_INVALID_ARG_TYPE");
  });

  it("still works as a tag", () => {
    setColorEnabled(false);
    expect(colorTag`a {red b} ${1}`).toBe("a b 1");
    expect(createColorTag(stream as never)`x {bold y}`).toBe("x y");
  });
});

describe("TSDoc phrases", () => {
  it("has no stale vocabulary", () => {
    expect(tsdoc.toLowerCase()).not.toContain("proxy");
    expect(tsdoc).not.toContain("bar colour");
    expect(tsdoc).not.toContain("progress bar color");
    expect(source).not.toContain("bar colour");
    expect(source).not.toContain("progress bar color");
  });

  it("StyleSpec names the real options", () => {
    const doc = docBefore("export type StyleSpec");
    expect(doc).toContain("`style`");
    expect(doc).toContain("`borderStyle`");
    expect(doc).toContain("`headerStyle`");
  });

  it("stripAnsi documents @throws", () => {
    expect(docBefore("export function stripAnsi")).toContain("@throws");
  });

  it("color and Colorizer document the RangeError for an unknown style", () => {
    for (const anchor of ["export const color:", "export type Colorizer"]) {
      const doc = docBefore(anchor);
      expect(doc).toContain("@throws {RangeError}");
      expect(doc).toContain("ERR_INVALID_ARG_VALUE");
    }
  });

  it("stream entry points document the TypeError", () => {
    for (const anchor of [
      "export function createColorizer",
      "export function createColorTag",
      "export function isColorEnabled",
    ]) {
      expect(docBefore(anchor)).toContain("@throws {TypeError}");
    }
  });
});
