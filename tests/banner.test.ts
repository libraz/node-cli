import { describe, expect, it } from "vitest";
import { CLI } from "../src/cli.js";

describe("Banner and Description", () => {
  describe("description()", () => {
    it("is chainable and returns the CLI instance", () => {
      const cli = new CLI({ name: "myapp" });
      const result = cli.description("A cool tool");
      expect(result).toBe(cli);
    });
  });

  describe("banner()", () => {
    it("is chainable and returns the CLI instance", () => {
      const cli = new CLI({ name: "myapp" });
      const result = cli.banner("Welcome!");
      expect(result).toBe(cli);
    });

    it("can be set to empty string to suppress", () => {
      const cli = new CLI({ name: "myapp", version: "1.0.0" });
      const result = cli.banner("");
      expect(result).toBe(cli);
    });
  });

  describe("options constructor", () => {
    it("accepts description and banner in options", () => {
      const cli = new CLI({
        name: "myapp",
        version: "1.0.0",
        description: "A test CLI",
        banner: "Welcome to myapp!",
      });
      expect(cli).toBeDefined();
    });
  });

  describe("help output includes metadata", () => {
    it("shows name and version in help", async () => {
      const cli = new CLI({ name: "myapp", version: "2.0.0", description: "A test tool" });
      cli.command("test").description("Test command");

      let output = "";
      await cli.exec("help", {
        stdout: {
          write(data: string) {
            output += data;
            return true;
          },
        } as NodeJS.WritableStream,
      });

      expect(output).toContain("myapp v2.0.0");
      expect(output).toContain("A test tool");
    });

    it("updates metadata after description() chain call", async () => {
      const cli = new CLI({ name: "myapp", version: "1.0.0" });
      cli.description("Updated description");
      cli.command("test").description("Test command");

      let output = "";
      await cli.exec("help", {
        stdout: {
          write(data: string) {
            output += data;
            return true;
          },
        } as NodeJS.WritableStream,
      });

      expect(output).toContain("Updated description");
    });
  });
});
