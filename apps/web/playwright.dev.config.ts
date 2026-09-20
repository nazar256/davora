import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const chromeExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "/usr/bin/google-chrome";
const useSystemChrome = Boolean(chromeExecutable && existsSync(chromeExecutable));
const workerPort = 8789;
const webPort = 4174;

// Dev-server coverage for the PWA contract (A32): the main suite runs against
// `vite preview`, while this config keeps `vite dev` behavior under test.
// Runs after the main suite via `test:playwright`, so shared ports are safe.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/pwa-dev.spec.ts"],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "en-US",
    timezoneId: "UTC"
  },
  webServer: [
    {
      command: `SESSION_SECRET=playwright-dev-secret RUNTIME_MODE=development MOCK_BACKEND=true LOCAL_DEV_STATE_PATH=../../.tmp/playwright-dev/worker-state-$$.json PORT=${workerPort} node --import ../../node_modules/tsx/dist/loader.mjs src/node-server.ts`,
      cwd: "../worker",
      url: `http://127.0.0.1:${workerPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:${workerPort} vite --host 127.0.0.1 --port ${webPort}`,
      cwd: ".",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        channel: undefined,
        launchOptions: {
          ...(useSystemChrome ? { executablePath: chromeExecutable } : {})
        }
      }
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        channel: undefined,
        launchOptions: {
          ...(useSystemChrome ? { executablePath: chromeExecutable } : {})
        }
      }
    }
  ]
});
