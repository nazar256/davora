import { defineConfig } from "vitest/config";

const pureBoundary = [
  "src/http/{router,context,failure,application}.ts",
  "src/security/{http,nextcloudDestinationPolicy,token}.ts",
  "src/accounts/{repository,transaction,persistedAccountStateCodec}.ts",
  "src/files/{fileBackendError,service}.ts"
];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: pureBoundary,
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "../../.tmp/wave3/coverage/worker",
      thresholds: Object.fromEntries(pureBoundary.map((glob) => [glob, {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85
      }]))
    }
  }
});
