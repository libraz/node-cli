import { type CLIEventMap, createCLI } from "../../src/index.js";

const cli = createCLI({ name: "app" });

// The exit handler receives the exit code; a handler that ignores it still fits.
cli.on("exit", (code: number) => {
  void code;
});
cli.on("exit", () => {});
cli.on("exit", async (code) => {
  const value: number = code;
  void value;
});
// @ts-expect-error the exit code is a number
cli.on("exit", (code: string) => {
  void code;
});

const handler: CLIEventMap["exit"] = (code) => {
  void code;
};
handler(0);
// @ts-expect-error the exit handler takes the code
handler();
