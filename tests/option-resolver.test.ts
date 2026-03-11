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
