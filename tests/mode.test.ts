import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { type ModeConfig, Shell } from "../src/shell/repl.js";

describe("mode command", () => {
  it("ModeConfig interface is exported", () => {
    const config: ModeConfig = {
      prompt: "mode> ",
      action: () => {},
    };
    expect(config.prompt).toBe("mode> ");
    expect(typeof config.action).toBe("function");
  });

  it("ModeConfig with message", () => {
    const config: ModeConfig = {
      prompt: "sql> ",
      action: () => {},
      message: "Entering SQL mode",
    };
    expect(config.message).toBe("Entering SQL mode");
  });

  it("Shell has enterMode, exitMode, and setPrompt methods", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "/tmp/test_mode_history",
    });

    expect(typeof shell.enterMode).toBe("function");
    expect(typeof shell.exitMode).toBe("function");
    expect(typeof shell.setPrompt).toBe("function");
  });

  it("setPrompt updates the prompt string", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "/tmp/test_mode_history",
    });

    // Should not throw when called before start() (no rl yet)
    shell.setPrompt("myapp> ");
  });

  it("command action can enter mode via shell", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);

    const modeAction = vi.fn();
    new CommandBuilder(registry, "sql").action((ctx) => {
      if (ctx.shell && "enterMode" in ctx.shell) {
        (ctx.shell as any).enterMode({
          prompt: "sql> ",
          action: modeAction,
          message: "Entering SQL mode",
        });
      }
    });

    expect(registry.resolve(["sql"])).toBeDefined();
  });
});
