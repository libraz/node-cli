import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { CancelledError, InputEndedError, prompt } from "../src/index.js";

function createStreams() {
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { stdin, stderr, getOutput: () => output };
}

type Io = { stdin?: PassThrough | null; stderr: PassThrough };

const kinds: Record<string, (message: string, io: Io) => Promise<unknown>> = {
  text: (message, io) => prompt.text(message, io),
  confirm: (message, io) => prompt.confirm(message, io),
  select: (message, io) => prompt.select(message, ["a", "b"], io),
  multiselect: (message, io) => prompt.multiselect(message, ["a", "b"], io),
  password: (message, io) => prompt.password(message, io),
};

describe("prompt input failures", () => {
  it.each(Object.keys(kinds))(
    "rejects a null stdin before writing the question: %s",
    async (name) => {
      const streams = createStreams();
      const error = await kinds[name]("Question", { stdin: null, stderr: streams.stderr }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(InputEndedError);
      expect((error as InputEndedError).code).toBe("INPUT_ENDED");
      expect((error as InputEndedError).promptMessage).toBe("Question");
      expect((error as Error).message).toContain("No input available for the prompt: Question");
      expect(streams.getOutput()).toBe("");
    },
  );

  it.each(Object.keys(kinds))("rejects with InputEndedError at EOF: %s", async (name) => {
    const streams = createStreams();
    const pending = kinds[name]("Question", streams);
    streams.stdin.end();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputEndedError);
    expect((error as InputEndedError).promptMessage).toBe("Question");
  });

  it("rejects with InputEndedError when the input ends during a re-ask", async () => {
    const streams = createStreams();
    const pending = prompt.text("Name", {
      stdin: streams.stdin,
      stderr: streams.stderr,
      validate: (value) => {
        if (value === "bad") throw new Error("nope");
      },
    });
    streams.stdin.end("bad\n");
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputEndedError);
    expect(streams.getOutput()).toContain("nope");
  });

  it("rejects with the original error when the input fails", async () => {
    const streams = createStreams();
    const failure = new Error("EIO");
    const pending = prompt.text("Name", streams);
    streams.stdin.destroy(failure);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBe(failure);
  });

  it("rejects with the original error when the input fails during a re-ask", async () => {
    const streams = createStreams();
    const failure = new Error("EIO");
    let asks = 0;
    const pending = prompt.text("Name", {
      stdin: streams.stdin,
      stderr: streams.stderr,
      validate: () => {
        asks++;
        throw new Error("again");
      },
    });
    streams.stdin.write("x\n");
    while (asks === 0) await new Promise((resolve) => setImmediate(resolve));
    streams.stdin.destroy(failure);
    expect(await pending.catch((e: unknown) => e)).toBe(failure);
  });

  it("cancels with the signal reason as the cause", async () => {
    const streams = createStreams();
    const controller = new AbortController();
    const reason = new Error("deadline");
    const pending = prompt.text("Name", { ...streams, signal: controller.signal });
    controller.abort(reason);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(reason);
  });

  it("reads the next buffered line when it re-asks", async () => {
    const streams = createStreams();
    const pending = prompt.text("Name", {
      stdin: streams.stdin,
      stderr: streams.stderr,
      validate: (value) => {
        if (value === "bad") throw new Error("nope");
      },
    });
    streams.stdin.end("bad\ngood\n");
    await expect(pending).resolves.toBe("good");
  });

  it("re-asks from buffered lines of an input that had already ended", async () => {
    const streams = createStreams();
    const stdin = Readable.from(["bad\ngood\n"]);
    const answer = prompt.text("Name", {
      stdin,
      stderr: streams.stderr,
      validate: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (value === "bad") throw new Error("nope");
      },
    });
    await expect(answer).resolves.toBe("good");
  });

  it("rejects with InputEndedError when a re-ask finds the ended input empty", async () => {
    const streams = createStreams();
    const answer = prompt.text("Name", {
      stdin: Readable.from(["bad\n"]),
      stderr: streams.stderr,
      validate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("nope");
      },
    });
    await expect(answer).rejects.toBeInstanceOf(InputEndedError);
  });

  it("re-asks a select from buffered lines on an ended input", async () => {
    const streams = createStreams();
    const pending = prompt.select("Env", ["a", "b"], streams);
    streams.stdin.end("9\n2\n");
    await expect(pending).resolves.toBe("b");
  });

  it("re-asks a confirm from buffered lines on an ended input", async () => {
    const streams = createStreams();
    const pending = prompt.confirm("Sure?", streams);
    streams.stdin.end("maybe\nyes\n");
    await expect(pending).resolves.toBe(true);
  });

  it("re-asks a password from buffered lines on an ended input", async () => {
    const streams = createStreams();
    const pending = prompt.password("Token", { ...streams, required: true });
    streams.stdin.end("\nsecret\n");
    await expect(pending).resolves.toBe("secret");
  });
});

describe("prompt defaults that match no choice", () => {
  it("select rejects before asking", async () => {
    const streams = createStreams();
    const error = await prompt
      .select("Env", ["dev", "prod"], { ...streams, default: "stage" as string })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as { code: string }).code).toBe("ERR_INVALID_ARG_VALUE");
    expect(streams.getOutput()).toBe("");
  });

  it("multiselect rejects before asking when any default element matches nothing", async () => {
    const streams = createStreams();
    const error = await prompt
      .multiselect("Pick", ["a", "b"], { ...streams, default: ["a", "z"] as string[] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as { code: string }).code).toBe("ERR_INVALID_ARG_VALUE");
    expect(streams.getOutput()).toBe("");
  });

  it("accepts a default that is a choice value of a descriptor", async () => {
    const streams = createStreams();
    const pending = prompt.select(
      "Env",
      [
        { label: "Development", value: "dev" },
        { label: "Production", value: "prod" },
      ],
      { ...streams, default: "prod" },
    );
    streams.stdin.end("\n");
    await expect(pending).resolves.toBe("prod");
  });
});

describe("prompt argument validation", () => {
  const bad = (call: () => Promise<unknown>) => call().catch((e: unknown) => e);

  async function expectTypeError(
    streams: ReturnType<typeof createStreams>,
    call: () => Promise<unknown>,
    fragment: string,
  ) {
    const error = await bad(call);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as { code: string }).code).toBe("ERR_INVALID_ARG_TYPE");
    expect((error as Error).message).toContain(fragment);
    expect(streams.getOutput()).toBe("");
  }

  it("rejects a non-string message", async () => {
    const streams = createStreams();
    await expectTypeError(
      streams,
      () => prompt.text(42 as unknown as string, streams),
      'The "message" argument of prompt.text() must be a string',
    );
    await expectTypeError(
      streams,
      () => prompt.confirm(undefined as unknown as string, streams),
      'The "message" argument of prompt.confirm() must be a string',
    );
    await expectTypeError(
      streams,
      () => prompt.password(null as unknown as string, streams),
      'The "message" argument of prompt.password() must be a string',
    );
  });

  it("rejects choices that are not an array", async () => {
    const streams = createStreams();
    await expectTypeError(
      streams,
      () => prompt.select("Env", "dev" as unknown as string[], streams),
      'The "choices" argument of prompt.select() must be an array',
    );
    await expectTypeError(
      streams,
      () => prompt.multiselect("Env", undefined as unknown as string[], streams),
      'The "choices" argument of prompt.multiselect() must be an array',
    );
  });

  it("rejects a validate that is not a function", async () => {
    const streams = createStreams();
    const validate = "no" as unknown as () => void;
    await expectTypeError(
      streams,
      () => prompt.text("Name", { ...streams, validate }),
      'The "validate" option of prompt.text() must be a function',
    );
    await expectTypeError(
      streams,
      () => prompt.select("Env", ["a"], { ...streams, validate }),
      'The "validate" option of prompt.select() must be a function',
    );
  });

  it("rejects a confirm default that is not a boolean", async () => {
    const streams = createStreams();
    await expectTypeError(
      streams,
      () => prompt.confirm("Sure?", { ...streams, default: "yes" as unknown as boolean }),
      'The "default" option of prompt.confirm() must be a boolean',
    );
  });

  it("treats explicitly undefined options like omitted ones", async () => {
    const streams = createStreams();
    const pending = prompt.text("Name", {
      stdin: streams.stdin,
      stderr: streams.stderr,
      validate: undefined,
      default: undefined,
      marker: undefined,
    });
    streams.stdin.end("Ada\n");
    await expect(pending).resolves.toBe("Ada");
  });
});
