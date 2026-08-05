import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types.ts", "src/option/schema.ts"],
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 70,
        functions: 70,
        lines: 80,
      },
    },
  },
});
