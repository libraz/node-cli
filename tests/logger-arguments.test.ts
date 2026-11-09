import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/index.js";

describe("Logger.child argument checks", () => {
  it("throws TypeError ERR_INVALID_ARG_TYPE for a non-string prefix", () => {
    const log = createLogger({ stderr: new PassThrough() });
    let caught: unknown;
    try {
      log.child(undefined as unknown as string);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    expect((caught as Error).message).toContain("Logger.child()");
  });

  it("rejects a numeric prefix with the same subject", () => {
    const log = createLogger({ stderr: new PassThrough() });
    expect(() => log.child(42 as unknown as string)).toThrow(TypeError);
    expect(() => log.child(42 as unknown as string)).toThrow(/Logger\.child\(\)/);
  });
});

describe("logger.ts documentation", () => {
  const source = readFileSync(new URL("../src/output/logger.ts", import.meta.url), "utf8");

  /** Returns the doc comment block that immediately precedes the member declared at `signature`. */
  const docBefore = (signature: string): string => {
    const at = source.indexOf(signature);
    expect(at).toBeGreaterThan(0);
    const start = source.lastIndexOf("/**", at);
    return source.slice(start, at);
  };

  it("documents @throws on Logger.setLevel", () => {
    expect(docBefore("setLevel(level: LogLevel): this;")).toContain("@throws");
  });

  it("documents @throws on Logger.child", () => {
    expect(docBefore("child(prefix: string): Logger;")).toContain("@throws");
  });
});
