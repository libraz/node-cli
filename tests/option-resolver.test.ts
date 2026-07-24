import { describe, expect, it } from "vitest";
import { InvalidOptionError, MissingOptionError, ValidationError } from "../src/errors.js";
import { resolveOptions } from "../src/option/resolver.js";
import type { CommandContext, OptionDef } from "../src/types.js";

function makeDef(long: string, schema: OptionDef["schema"], aliases: string[] = []): OptionDef {
  return {
    long,
    aliases,
    takesValue: schema.type !== "boolean",
    schema,
  };
}

const dummyCtx = {} as CommandContext;

describe("resolveOptions", () => {
  it("returns raw value as string by default", () => {
    const defs = new Map([["name", makeDef("name", { type: "string" })]]);
    const result = resolveOptions({ name: "foo" }, defs, dummyCtx);
    expect(result.name).toBe("foo");
  });

  it("coerces to number", () => {
    const defs = new Map([["port", makeDef("port", { type: "number" })]]);
    const result = resolveOptions({ port: "3000" }, defs, dummyCtx);
    expect(result.port).toBe(3000);
  });

  it("throws on invalid number", () => {
    const defs = new Map([["port", makeDef("port", { type: "number" })]]);
    expect(() => resolveOptions({ port: "abc" }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("throws on non-finite numbers", () => {
    const defs = new Map([["port", makeDef("port", { type: "number" })]]);
    expect(() => resolveOptions({ port: "Infinity" }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("coerces to boolean", () => {
    const defs = new Map([["force", makeDef("force", { type: "boolean" })]]);
    expect(resolveOptions({ force: true }, defs, dummyCtx).force).toBe(true);
    expect(resolveOptions({ force: "true" }, defs, dummyCtx).force).toBe(true);
    expect(resolveOptions({ force: "false" }, defs, dummyCtx).force).toBe(false);
  });

  it("coerces to string[]", () => {
    const defs = new Map([["file", makeDef("file", { type: "string[]" })]]);
    expect(resolveOptions({ file: ["a", "b"] }, defs, dummyCtx).file).toEqual(["a", "b"]);
    expect(resolveOptions({ file: "a" }, defs, dummyCtx).file).toEqual(["a"]);
  });

  it("coerces to number[]", () => {
    const defs = new Map([["ids", makeDef("ids", { type: "number[]" })]]);
    expect(resolveOptions({ ids: ["1", "2"] }, defs, dummyCtx).ids).toEqual([1, 2]);
  });

  it("throws on invalid number[]", () => {
    const defs = new Map([["ids", makeDef("ids", { type: "number[]" })]]);
    expect(() => resolveOptions({ ids: ["abc"] }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("applies default value", () => {
    const defs = new Map([["tag", makeDef("tag", { type: "string", default: "latest" })]]);
    const result = resolveOptions({}, defs, dummyCtx);
    expect(result.tag).toBe("latest");
  });

  it("throws on missing required option", () => {
    const defs = new Map([["token", makeDef("token", { type: "string", required: true })]]);
    expect(() => resolveOptions({}, defs, dummyCtx)).toThrow(MissingOptionError);
  });

  it("does not overwrite falsy explicit values with a default", () => {
    const numberDefs = new Map([["port", makeDef("port", { type: "number", default: 8080 })]]);
    expect(resolveOptions({ port: "0" }, numberDefs, dummyCtx).port).toBe(0);

    const stringDefs = new Map([["name", makeDef("name", { type: "string", default: "anon" })]]);
    expect(resolveOptions({ name: "" }, stringDefs, dummyCtx).name).toBe("");

    const boolDefs = new Map([["cache", makeDef("cache", { type: "boolean", default: true })]]);
    expect(resolveOptions({ cache: "false" }, boolDefs, dummyCtx).cache).toBe(false);
  });

  it("coerces a string default on a number option to a number", () => {
    const defs = new Map([["port", makeDef("port", { type: "number", default: "8080" })]]);
    const result = resolveOptions({}, defs, dummyCtx);
    expect(result.port).toBe(8080);
    expect(typeof result.port).toBe("number");
  });

  it("leaves a default that is already the correct type unchanged", () => {
    const defs = new Map([["port", makeDef("port", { type: "number", default: 8080 })]]);
    expect(resolveOptions({}, defs, dummyCtx).port).toBe(8080);
  });

  it("accepts number coercion edge cases", () => {
    const defs = new Map([["n", makeDef("n", { type: "number" })]]);
    expect(resolveOptions({ n: "-5" }, defs, dummyCtx).n).toBe(-5);
    expect(resolveOptions({ n: "1e3" }, defs, dummyCtx).n).toBe(1000);
  });

  it("rejects blank and non-finite numbers", () => {
    const defs = new Map([["n", makeDef("n", { type: "number" })]]);
    expect(() => resolveOptions({ n: "" }, defs, dummyCtx)).toThrow(InvalidOptionError);
    expect(() => resolveOptions({ n: "   " }, defs, dummyCtx)).toThrow(InvalidOptionError);
    expect(() => resolveOptions({ n: "Infinity" }, defs, dummyCtx)).toThrow(InvalidOptionError);
    expect(() => resolveOptions({ n: "NaN" }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("recognizes boolean value variants", () => {
    const defs = new Map([["flag", makeDef("flag", { type: "boolean" })]]);
    for (const truthy of ["1", "yes", "on", "true"]) {
      expect(resolveOptions({ flag: truthy }, defs, dummyCtx).flag).toBe(true);
    }
    for (const falsy of ["0", "no", "off", "false"]) {
      expect(resolveOptions({ flag: falsy }, defs, dummyCtx).flag).toBe(false);
    }
  });

  it("rejects an unrecognized boolean value", () => {
    const defs = new Map([["flag", makeDef("flag", { type: "boolean" })]]);
    expect(() => resolveOptions({ flag: "hello" }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("does not inject a value for an omitted optional option", () => {
    const defs = new Map([["flag", makeDef("flag", { type: "boolean" })]]);
    const result = resolveOptions({}, defs, dummyCtx);
    expect(result.flag).toBeUndefined();
    expect(Object.hasOwn(result, "flag")).toBe(false);
  });

  it("treats a present scalar flag whose custom parse returns undefined as explicit", () => {
    const defs = new Map([
      [
        "opt",
        makeDef("opt", {
          type: "string",
          default: "fallback",
          required: true,
          parse() {
            return undefined;
          },
        }),
      ],
    ]);
    // Present: default is not applied and no MissingOptionError is thrown.
    const result = resolveOptions({ opt: "x" }, defs, dummyCtx);
    expect(result.opt).toBeUndefined();
    expect(Object.hasOwn(result, "opt")).toBe(true);
    // Absent: required presence wins over a contradictory default.
    expect(() => resolveOptions({}, defs, dummyCtx)).toThrow(MissingOptionError);
  });

  it("treats scalar and array custom-parse-returns-undefined consistently", () => {
    const scalarDefs = new Map([
      ["opt", makeDef("opt", { type: "string", required: true, parse: () => undefined })],
    ]);
    const arrayDefs = new Map([
      ["opt", makeDef("opt", { type: "string[]", required: true, parse: () => undefined })],
    ]);
    // Neither treats a present flag as missing.
    expect(() => resolveOptions({ opt: "x" }, scalarDefs, dummyCtx)).not.toThrow();
    expect(() => resolveOptions({ opt: ["x"] }, arrayDefs, dummyCtx)).not.toThrow();
    // Both still enforce required when the flag is genuinely absent.
    expect(() => resolveOptions({}, scalarDefs, dummyCtx)).toThrow(MissingOptionError);
    expect(() => resolveOptions({}, arrayDefs, dummyCtx)).toThrow(MissingOptionError);
  });

  it("validates choices", () => {
    const defs = new Map([["env", makeDef("env", { type: "string", choices: ["prod", "dev"] })]]);
    expect(resolveOptions({ env: "prod" }, defs, dummyCtx).env).toBe("prod");
    expect(() => resolveOptions({ env: "staging" }, defs, dummyCtx)).toThrow(InvalidOptionError);
  });

  it("runs custom validate", () => {
    const defs = new Map([
      [
        "token",
        makeDef("token", {
          type: "string",
          validate(value) {
            if (typeof value === "string" && value.length < 5) {
              throw new Error("too short");
            }
          },
        }),
      ],
    ]);
    expect(() => resolveOptions({ token: "abc" }, defs, dummyCtx)).toThrow(ValidationError);
    expect(resolveOptions({ token: "abcde" }, defs, dummyCtx).token).toBe("abcde");
  });

  it("provides the complete canonical option set to cross-option validation", () => {
    const defs = new Map([
      [
        "start",
        makeDef("start", {
          type: "number",
          validate(value, ctx) {
            if ((value as number) >= (ctx.options.end as number)) throw new Error("invalid range");
          },
        }),
      ],
      ["end", makeDef("end", { type: "number", default: 10 })],
    ]);
    const ctx = { options: {} } as CommandContext;
    expect(resolveOptions({ start: "2" }, defs, ctx)).toMatchObject({ start: 2, end: 10 });
    expect(() => resolveOptions({ start: "20", end: "30" }, defs, ctx)).not.toThrow();
    expect(() => resolveOptions({ start: "20", end: "10" }, defs, ctx)).toThrow("invalid range");
  });

  it("normalizes non-Error custom validate failures", () => {
    const defs = new Map([
      [
        "token",
        makeDef("token", {
          validate() {
            throw "invalid token";
          },
        }),
      ],
    ]);
    expect(() => resolveOptions({ token: "x" }, defs, dummyCtx)).toThrow(ValidationError);
  });

  it("runs custom parse", () => {
    const defs = new Map([
      [
        "port",
        makeDef("port", {
          type: "string",
          parse(value) {
            return Number(value) * 2;
          },
        }),
      ],
    ]);
    const result = resolveOptions({ port: "100" }, defs, dummyCtx);
    expect(result.port).toBe(200);
  });

  it("wraps non-Error custom parse failures in ValidationError", () => {
    const defs = new Map([
      [
        "token",
        makeDef("token", {
          type: "string",
          parse() {
            throw "bad token";
          },
        }),
      ],
    ]);
    expect(() => resolveOptions({ token: "x" }, defs, dummyCtx)).toThrow(ValidationError);
  });

  it("resolves aliases", () => {
    const defs = new Map([["tag", makeDef("tag", { type: "string" }, ["t"])]]);
    const result = resolveOptions({ t: "v2" }, defs, dummyCtx);
    expect(result.tag).toBe("v2");
  });

  it("passes through unknown options", () => {
    const defs = new Map<string, OptionDef>();
    const result = resolveOptions({ unknown: "val" }, defs, dummyCtx);
    expect(result.unknown).toBe("val");
  });
});
