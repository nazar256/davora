import { mkdir, mkdtemp } from "node:fs/promises";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

const chromeExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? "/usr/bin/google-chrome";
const useSystemChrome = Boolean(chromeExecutable && existsSync(chromeExecutable));
const workerPort = 8787;

async function dismissToastIfVisible(page: Page) {
  const dismissButton = page.getByRole("button", { name: /^Dismiss$/i });
  if (await dismissButton.count()) {
    await dismissButton.first().click();
  }
}

async function connectAccount(page: Page, label = "PWA workspace") {
  await page.goto("/");
  await dismissToastIfVisible(page);
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();
}

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
}

async function fetchBuildLabel(page: Page) {
  const dialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  await expect(dialog).toBeVisible();
  const label = (await dialog.getByTestId("app-build-label").textContent())?.trim();
  await dialog.getByRole("button", { name: /Close|Done/i }).click();
  return label;
}

async function installCurrentPageAsPwa(page: Page, context: BrowserContext) {
  const pageSession = await context.newCDPSession(page);
  await pageSession.send("Page.enable");
  const appIdResponse = await pageSession.send("Page.getAppId") as { appId?: string };
  const manifestResponse = await pageSession.send("Page.getAppManifest") as { manifest?: { id?: string } };
  const manifestId = manifestResponse.manifest?.id ?? appIdResponse.appId ?? "/";
  await pageSession.send("PWA.install", { manifestId });
  return { pageSession, manifestId };
}

async function stopWorkerServer() {
  await fetch(`http://127.0.0.1:${workerPort}/__davora/stop-worker`, { method: "POST" });
}

async function dispatchBeforeInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "dismissed") {
  await page.evaluate(async (nextOutcome) => {
    const installEvent = new Event("beforeinstallprompt");
    Object.defineProperty(installEvent, "prompt", {
      value: async () => undefined
    });
    Object.defineProperty(installEvent, "userChoice", {
      value: Promise.resolve({ outcome: nextOutcome })
    });
    window.dispatchEvent(installEvent);
  }, outcome);
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4175", "8787")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("manifest metadata and Chrome installability checks pass outside incognito blockers", async ({ page, request, context }) => {
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as {
    id: string;
    name: string;
    short_name: string;
    categories?: string[];
    lang?: string;
    display: string;
    display_override?: string[];
    scope: string;
    start_url: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
    screenshots?: Array<{ src: string; sizes: string; form_factor?: string }>;
  };

  expect(manifest).toMatchObject({
    id: "/",
    name: "Davora",
    short_name: "Davora",
    lang: "en-US",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    categories: ["productivity", "utilities"],
    scope: "/",
    start_url: "/"
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/pwa-192.png", sizes: "192x192" }),
    expect.objectContaining({ src: "/pwa-512.png", sizes: "512x512" }),
    expect.objectContaining({ src: "/pwa-512-maskable.png", sizes: "512x512", purpose: "any maskable" })
  ]));
  expect(manifest.screenshots).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/pwa-512.png", sizes: "512x512", form_factor: "wide" })
  ]));

  const client = await context.newCDPSession(page);
  await client.send("Page.enable");
  const installability = await client.send("Page.getInstallabilityErrors") as {
    installabilityErrors?: Array<{ errorId?: string }>;
  };
  const blockingErrors = (installability.installabilityErrors ?? []).filter((error) => error.errorId !== "in-incognito");

  expect(blockingErrors).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((registrations) => registrations.length))).toBeGreaterThan(0);
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      hasController: Boolean(navigator.serviceWorker.controller),
      scope: registration.scope,
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    };
  })).toMatchObject({
    hasController: true,
    scope: "http://127.0.0.1:4175/",
    displayModeStandalone: false,
    manifestHref: "/manifest.webmanifest"
  });
});

test("install affordance stays contextual and does not obstruct zero-state onboarding", async ({ page }) => {
  await page.goto("/");
  await waitForServiceWorkerControl(page);
  await dispatchBeforeInstallPrompt(page, "dismissed");

  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Install app/i })).toHaveCount(0);
  await expect(page.getByText(/standalone launching and faster offline return visits/i)).toHaveCount(0);
  await expect(page.getByText(/App ready to work offline/i)).toHaveCount(0);

  await connectAccount(page, "Contextual install workspace");
  await dispatchBeforeInstallPrompt(page, "dismissed");

  await expect(page.getByRole("button", { name: /Install app/i })).toBeVisible();
  await expect(page.getByText(/standalone launching and faster offline return visits/i)).toHaveCount(0);
  await expect(page.getByText(/App ready to work offline/i)).toHaveCount(0);
});

test("offline preview build keeps cached account data usable after installable-shell reload", async ({ page, context }) => {
  await connectAccount(page, "Offline PWA workspace");
  await waitForServiceWorkerControl(page);
  await dismissToastIfVisible(page);

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Back to files/i }).click();
  await page.getByRole("button", { name: /Go to home folder/i }).click();

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(".badge.offline")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByText(/Offline snapshot/i)).toBeVisible();
  await expect(page.getByText(/Showing cached data while offline/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeDisabled();
  await expect.poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
});

test("update prompt reload applies changed build content", async ({ page, context }) => {
  await connectAccount(page, "Update workspace");
  await waitForServiceWorkerControl(page);
  await expect(await fetchBuildLabel(page)).toBe("pwa-initial");

  execSync(
    "VITE_APP_BUILD_LABEL=pwa-updated VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:8787 npm run build",
    { cwd: process.cwd(), stdio: "inherit" }
  );

  await page.reload();
  const reloadPrompt = page.getByRole("status");
  await expect(reloadPrompt.getByText(/Updated app shell ready/i)).toBeVisible();
  await reloadPrompt.getByRole("button", { name: /^Reload$/i }).click();
  await page.waitForLoadState("networkidle");

  await expect(await fetchBuildLabel(page)).toBe("pwa-updated");
  const client = await context.newCDPSession(page);
  await client.send("Page.enable");
  const manifest = await client.send("Page.getAppManifest") as { manifest: { id?: string } };
  expect(manifest.manifest.id).toBeTruthy();
});

test("offline preview build without primed account data falls back to zero-state honestly", async ({ page, context }) => {
  await page.goto("/");
  await waitForServiceWorkerControl(page);
  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(".badge.offline")).toBeVisible();
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect account/i })).toBeVisible();
  await expect(page.getByText(/Connect a Nextcloud account inside Davora/i)).toBeVisible();
  await expect(page.getByText(/Showing cached data while offline/i)).toHaveCount(0);
  await expect(page.getByText(/cached reads are available, mutations stay disabled/i)).toHaveCount(0);
});

test("installed PWA opens with cached shell when the worker is stopped but browser stays online", async ({ page, context }) => {
  test.skip(!useSystemChrome, "Installed-PWA CDP coverage requires a system Chrome binary with the PWA protocol domain.");
  const tempRoot = resolve(process.cwd(), "../../.tmp/pwa-installed-profiles");
  await mkdir(tempRoot, { recursive: true });
  const profileDir = await mkdtemp(join(tempRoot, "profile-"));
  const evidencePath = resolve(process.cwd(), "../../.tmp/pwa-installed-server-stopped.png");
  const persistentContext = await chromium.launchPersistentContext(profileDir, {
    ...(useSystemChrome ? { executablePath: chromeExecutable } : {}),
    headless: true,
    viewport: { width: 1280, height: 720 }
  });

  try {
    const persistentPage = persistentContext.pages()[0] ?? await persistentContext.newPage();
    await persistentPage.goto("http://127.0.0.1:4175/");
    await connectAccount(persistentPage, "Installed offline workspace");
    await waitForServiceWorkerControl(persistentPage);
    await persistentPage.getByRole("button", { name: /Open folder Projects/i }).click();
    await expect(persistentPage.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

    const { pageSession, manifestId } = await installCurrentPageAsPwa(persistentPage, persistentContext);
    await stopWorkerServer();
    const existingPages = persistentContext.pages().length;
    const launched = await pageSession.send("PWA.launch", { manifestId }) as { targetId: string };
    const appPage = await persistentContext.waitForEvent("page");
    await appPage.waitForLoadState("domcontentloaded");

    await expect(appPage.locator("#root")).toBeVisible();
    await expect(appPage.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await expect(appPage.getByText(/Server unavailable/i).first()).toBeVisible();
    await expect(appPage.getByText(/Showing cached data while the local server is unavailable/i)).toBeVisible();
    await expect(appPage.getByRole("button", { name: /Create folder/i })).toBeDisabled();
    await expect(appPage.getByRole("button", { name: /Retry restore/i })).toHaveCount(0);
    await expect.poll(async () => appPage.evaluate(() => navigator.onLine)).toBe(true);
    await expect.poll(async () => appPage.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
    await appPage.screenshot({ path: evidencePath, fullPage: true });
    expect(launched.targetId).toBeTruthy();
    expect(persistentContext.pages().length).toBeGreaterThan(existingPages);
    await pageSession.send("PWA.uninstall", { manifestId });
  } finally {
    await persistentContext.close();
  }
});
