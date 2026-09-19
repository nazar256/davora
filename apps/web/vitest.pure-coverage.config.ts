import { defineConfig } from "vitest/config";

import viteConfig from "./vite.config";

const pureBoundary = "src/features/**/{model,controller,policy,codec,planner,selectors}.ts";

export default defineConfig({
  ...viteConfig,
  test: {
    ...viteConfig.test,
    include: ["src/features/**/*.test.ts", "src/features/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: [pureBoundary],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "../../.tmp/wave3/coverage/web",
      thresholds: {
        [pureBoundary]: {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85
        }
      }
    }
  }
});
