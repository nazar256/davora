import { defineConfig, devices } from "@playwright/test";

const chromeExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "/usr/bin/google-chrome";
const workerPort = 8787;
const webPort = 4175;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/pwa.spec.ts"],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "en-US",
    timezoneId: "UTC"
  },
  webServer: [
    {
      command: `SESSION_SECRET=playwright-dev-secret MOCK_BACKEND=true PORT=${workerPort} node --import ../../node_modules/tsx/dist/loader.mjs src/node-server.ts`,
      cwd: "../worker",
      url: `http://127.0.0.1:${workerPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `VITE_APP_BUILD_LABEL=pwa-initial VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:${workerPort} npm run build && VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:${workerPort} vite preview --host 127.0.0.1 --port ${webPort}`,
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
          executablePath: chromeExecutable
        }
      }
    }
  ]
});
