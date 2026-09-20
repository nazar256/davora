import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    poolOptions: {
      forks: {
        // Node 24+ exposes a stub `localStorage`/`sessionStorage` global that
        // shadows the jsdom implementation unless webstorage is disabled.
        execArgv: ["--no-experimental-webstorage"]
      }
    }
  }
});
