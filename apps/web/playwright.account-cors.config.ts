import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const chromeExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "/usr/bin/chromium-browser";
const useSystemChrome = Boolean(chromeExecutable && existsSync(chromeExecutable));
const workerPort = 8787;
const webPort = 4173;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/account-cors.spec.ts"],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "en-US",
    timezoneId: "UTC"
  },
  webServer: [
    {
      command: `SESSION_SECRET=playwright-dev-secret RUNTIME_MODE=development MOCK_BACKEND=true ALLOWED_ORIGINS=http://127.0.0.1:${webPort} LOCAL_DEV_STATE_PATH=../../.tmp/account-actions-browser/cors-worker-state-$$.json PORT=${workerPort} node --import ../../node_modules/tsx/dist/loader.mjs src/node-server.ts`,
      cwd: "../worker",
      url: `http://127.0.0.1:${workerPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `VITE_API_BASE_URL=http://127.0.0.1:${workerPort} VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:${workerPort} vite --host 127.0.0.1 --port ${webPort}`,
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
    }
  ]
});
