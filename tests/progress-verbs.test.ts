import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { progress } from "../src/index.js";

/** A non-TTY stream that records everything written to it. */
function sink(): Writable & { out(): string } {
  let buffer = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });
  return Object.assign(stream, { out: () => buffer });
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectArgType(fn: () => unknown, subject: string): void {
  const error = catchError(fn);
  expect(error).toBeInstanceOf(TypeError);
  expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  expect((error as Error).message).toContain(subject);
}

type Verb = "succeed" | "fail" | "warn";
const verbs: Verb[] = ["succeed", "fail", "warn"];
const badMessages: unknown[] = [null, 5, {}, true, ["x"]];

interface Case {
  name: string;
  make: (stream: Writable) => Record<Verb, (message?: string) => void>;
}

const cases: Case[] = [
  { name: "Bar", make: (stderr) => progress.bar({ total: 10, label: "L", stderr }) },
  { name: "Spinner", make: (stderr) => progress.spinner({ label: "L", stderr }) },
  { name: "MultiBar", make: (stderr) => progress.multi({ stderr }) },
];

describe("succeed/fail/warn message validation", () => {
  for (const { name, make } of cases) {
    for (const verb of verbs) {
      it(`${name}.${verb}() rejects a non-string message`, () => {
        for (const bad of badMessages) {
          const handle = make(sink());
          expectArgType(() => handle[verb](bad as never), `${name}.${verb}()`);
          handle.stop();
        }
      });

      it(`${name}.${verb}() leaves the handle usable after a rejected message`, () => {
        const stream = sink();
        const handle = make(stream);
        expectArgType(() => handle[verb](null as never), `${name}.${verb}()`);
        expect(stream.out()).toBe("");
        handle.succeed("ok");
        expect(stream.out()).toContain("ok");
      });

      it(`${name}.${verb}() still validates on a finished handle`, () => {
        const handle = make(sink());
        handle.stop();
        expectArgType(() => handle[verb](null as never), `${name}.${verb}()`);
        expect(() => handle[verb]()).not.toThrow();
        expect(() => handle[verb]("fine")).not.toThrow();
      });
    }
  }

  it("a bar added to a MultiBar names Bar.<verb>() and stays usable", () => {
    const stream = sink();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 4, label: "job" });
    for (const verb of verbs) expectArgType(() => bar[verb](null as never), `Bar.${verb}()`);
    bar.succeed("done");
    expect(stream.out()).toContain("done");
    expectArgType(() => bar.warn(7 as never), "Bar.warn()");
    multi.stop();
  });

  it("accepts undefined and strings", () => {
    const stream = sink();
    const bar = progress.bar({ total: 2, label: "L", stderr: stream });
    bar.fail(undefined);
    expect(stream.out()).toContain("L");
  });
});

describe("progress TSDoc", () => {
  const source = readFileSync(new URL("../src/output/progress.ts", import.meta.url), "utf8");

  function section(header: string): string {
    const start = source.indexOf(header);
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("\n}\n", start));
  }

  /** The doc comment immediately before the first line of `body` starting with `signature`. */
  function docOf(body: string, signature: string): string {
    const at = body.indexOf(signature);
    expect(at).toBeGreaterThanOrEqual(0);
    return body.slice(body.lastIndexOf("/**", at), at);
  }

  it("describes ratePerSecond as an average", () => {
    const doc = docOf(section("export interface BarState"), "readonly ratePerSecond");
    expect(doc).toContain("Average");
    expect(doc).not.toContain("Current rate");
  });

  for (const name of ["Bar", "Spinner", "MultiBar"]) {
    const body = () => section(`export interface ${name} {`);

    it(`${name}: dispose is documented as stop()`, () => {
      expect(docOf(body(), "[Symbol.dispose]")).toContain("stop()");
    });

    for (const verb of verbs) {
      it(`${name}.${verb} documents @throws`, () => {
        expect(docOf(body(), `${verb}(message?: string)`)).toContain("@throws {TypeError}");
      });
    }
  }

  it("states that arguments are still validated after finishing", () => {
    for (const name of ["Bar", "Spinner"]) {
      const text = source.slice(
        source.indexOf(
          `Interface for controlling a ${name === "Bar" ? "progress bar" : "spinner"}`,
        ),
      );
      expect(text.slice(0, 500)).toContain("arguments are still validated");
    }
  });

  it("Spinner.setLabel mentions the result message", () => {
    expect(docOf(section("export interface Spinner {"), "setLabel(label: string)")).toContain(
      "result",
    );
  });
});
