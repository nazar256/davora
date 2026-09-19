import { defineConfig } from "vitest/config";

const pureBoundary = [
  "src/paths.ts",
  "src/accountSchemas.ts",
  "src/api/**/*.ts"
];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: pureBoundary,
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "../../.tmp/wave3/coverage/shared",
      thresholds: Object.fromEntries(pureBoundary.map((glob) => [glob, {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 90
      }]))
    }
  }
});
