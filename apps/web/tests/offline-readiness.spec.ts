import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { connectAccount, createGate, openSettings, openWorkspaceAction } from "./support/workspace";

const evidence = (device: string, state: string) => resolve(process.cwd(), `../../.tmp/agent-artifacts/implementation/offline-readiness-${device}-${state}.png`);
async function startFolder(page: Page) {
  await page.getByRole("button", { name: "Open actions for Projects", exact: true }).click();
  await page.getByRole("button", { name: "Keep offline", exact: true }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/ }).getByRole("button", { name: "Start sync", exact: true }).click();
}
test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, { headers: { "x-davora-reset-token": "playwright-dev-secret" } });
});

test("reload recovery is explicit, keeps saved bytes, and uses existing transfer surfaces", async ({ page }, info) => {
  const gate = createGate();
  let recover = false;
  const downloads: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 0, quota: 1048576 }), persist: () => { throw new Error("Persistence must not be requested"); } } });
  });
  await page.route("**/api/files?path=Projects&listing=complete-v1", (route) => route.fulfill({ json: { data: { path: "Projects", completeness: "complete", items: [
    { path: "Projects/a.txt", name: "a.txt", isFolder: false, size: 1, mimeType: "text/plain" },
    { path: "Projects/b.txt", name: "b.txt", isFolder: false, size: 2, mimeType: "text/plain" }
  ] } } }));
  await page.route("**/api/download?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path")!;
    downloads.push(path);
    if (path === "Projects/a.txt") return route.fulfill({ contentType: "text/plain", body: "a" });
    if (!recover) return route.fulfill({ status: 503, json: { data: { message: "Interrupted save", code: "temporary_failure" } } });
    await gate.promise;
    await route.fulfill({ contentType: "text/plain", body: "bb" });
  });
  await connectAccount(page, "Readiness recovery");
  await startFolder(page);
  await expect(page.locator(".transfer-tray-item-partial")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Open folder Projects/ })).toBeVisible();
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/ });
  const warning = settings.getByRole("button", { name: "Incomplete", exact: true });
  await expect(warning).toBeVisible();
  await warning.focus();
  await warning.press("Enter");
  await expect(settings.getByText("This selection is not fully saved.")).toBeVisible();
  await warning.press("Enter");
  if (info.project.name === "mobile-chrome") await warning.tap(); else await warning.click();
  await expect(settings.getByText("This selection is not fully saved.")).toBeVisible();
  const storage = settings.getByRole("button", { name: "Storage details" });
  await storage.click();
  await expect(settings.getByText(/This browser: approximately 0 B/)).toBeVisible();
  await expect(settings.getByText(/Retained originals: 1 B/)).toBeVisible();
  const box = await settings.locator(".storage-explanation").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: evidence(info.project.name, "incomplete-storage") });
  await settings.getByRole("button", { name: /Close|Done/ }).first().click();
  await openWorkspaceAction(page, /^Go offline$/);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(request.url()); });
  await openSettings(page);
  await expect(settings.getByRole("button", { name: "Retry offline copy for Projects" })).toBeDisabled();
  await page.screenshot({ path: evidence(info.project.name, "offline-disabled") });
  expect(requests).toEqual([]);
  await settings.getByRole("button", { name: /Close|Done/ }).first().click();
  await openWorkspaceAction(page, /^Go online$/);
  await openSettings(page);
  recover = true;
  await settings.getByRole("button", { name: "Retry offline copy for Projects" }).click();
  const tray = page.getByRole("dialog", { name: "Transfer status" });
  await expect(settings).not.toBeVisible();
  await expect(tray).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Keep offline confirmation/ })).toHaveCount(0);
  await expect.poll(() => downloads.filter((path) => path === "Projects/b.txt").length).toBe(2);
  expect(downloads.filter((path) => path === "Projects/a.txt")).toHaveLength(1);
  await page.screenshot({ path: evidence(info.project.name, "retry-progress") });
  const beforeBack = await page.evaluate(() => ({ state: history.state, url: location.href, navigation: document.querySelector(".nav-drawer")?.className, dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.getAttribute("aria-label")) }));
  await page.evaluate(() => {
    window.addEventListener("popstate", (event) => { (window as Window & { readinessPopState?: unknown }).readinessPopState = event.state; }, { once: true });
  });
  await page.goBack();
  const afterBack = await page.evaluate(() => ({ state: history.state, url: location.href, navigation: document.querySelector(".nav-drawer")?.className, popstate: (window as Window & { readinessPopState?: unknown }).readinessPopState, dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.getAttribute("aria-label")) }));
  await info.attach("back-state", { body: JSON.stringify({ beforeBack, afterBack }), contentType: "application/json" });
  writeFileSync(evidence(info.project.name, "back-state") + ".json", JSON.stringify({ beforeBack, afterBack }));
  expect(afterBack.state.accountId).toBe(beforeBack.state.accountId);
  expect(afterBack.state.path).toBe(beforeBack.state.path);
  expect(afterBack.url).toBe(beforeBack.url);
  if (beforeBack.navigation === "nav-drawer open") {
    await expect(page.locator(".nav-drawer")).not.toHaveClass(/open/);
    await expect(tray).toBeVisible();
    await page.goBack();
    expect(await page.evaluate(() => ({ accountId: history.state.accountId, path: history.state.path }))).toEqual({ accountId: beforeBack.state.accountId, path: beforeBack.state.path });
  }
  await expect(tray).not.toBeVisible();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(tray).toBeVisible();
  gate.release();
  await expect(tray.locator(".transfer-tray-item-done")).toBeVisible();
  await tray.getByRole("button", { name: "Close transfer status" }).click();
  await openSettings(page);
  await expect(settings.getByLabel("Saved offline")).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Retry offline copy/ })).toHaveCount(0);
  await settings.getByLabel("Saved offline").scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence(info.project.name, "saved") });
});

test("cancel retained retry keeps originals and prevents late completion", async ({ page }, info) => {
  const gate = createGate();
  let retry = false;
  let blockedRequests = 0;
  await page.route("**/api/files?path=Projects&listing=complete-v1", (route) => route.fulfill({ json: { data: { path: "Projects", completeness: "complete", items: [
    { path: "Projects/a.txt", name: "a.txt", isFolder: false, size: 1, mimeType: "text/plain" },
    { path: "Projects/b.txt", name: "b.txt", isFolder: false, size: 2, mimeType: "text/plain" }
  ] } } }));
  await page.route("**/api/download?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("path") === "Projects/a.txt") return route.fulfill({ contentType: "text/plain", body: "a" });
    if (!retry) return route.fulfill({ status: 503, json: { data: { message: "Interrupted save", code: "temporary_failure" } } });
    blockedRequests += 1;
    await gate.promise;
    await route.fulfill({ contentType: "text/plain", body: "bb" }).catch(() => undefined);
  });
  await connectAccount(page, "Cancel retained retry");
  await startFolder(page);
  await expect(page.locator(".transfer-tray-item-partial")).toBeVisible();
  await page.reload();
  await openSettings(page);
  retry = true;
  await page.getByRole("button", { name: "Retry offline copy for Projects" }).click();
  const tray = page.getByRole("dialog", { name: "Transfer status" });
  await expect.poll(() => blockedRequests).toBe(1);
  await page.goBack();
  await expect(tray).not.toBeVisible();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await tray.getByRole("button", { name: "Cancel Projects" }).click();
  await expect(tray.locator(".transfer-tray-item-canceled")).toBeVisible();
  gate.release();
  await page.screenshot({ path: evidence(info.project.name, "canceled") });
  await tray.getByRole("button", { name: "Close transfer status" }).click();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Incomplete", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Storage details" }).click();
  await expect(page.getByText(/Retained originals: 1 B/)).toBeVisible();
  expect(blockedRequests).toBe(1);
  await page.screenshot({ path: evidence(info.project.name, "canceled-originals") });
});

test("missing, saved, empty and old batch rows stay compact and usable", async ({ page }, info) => {
  await page.route("**/api/files?path=Projects&listing=complete-v1", (route) => route.fulfill({ json: { data: { path: "Projects", completeness: "complete", items: [
    { path: "Projects/a.txt", name: "a.txt", isFolder: false, size: 1, mimeType: "text/plain" },
    { path: "Projects/b.txt", name: "b.txt", isFolder: false, size: 1, mimeType: "text/plain" }
  ] } } }));
  await page.route("**/api/download?*", (route) => route.fulfill({ contentType: "text/plain", body: "a" }));
  await connectAccount(page, "Retained states");
  await startFolder(page);
  await expect(page.locator(".transfer-tray-item-done")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("keyval", "readwrite");
      const store = transaction.objectStore("keyval");
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const key = keys.result.find((key) => String(key).startsWith("davora-opened-file:v2:index:"))!;
        const read = store.get(key);
        read.onsuccess = () => {
          const index = read.result;
          index.files["Projects/a.txt"].readable = false;
          const roots = [
            { kind: "batch", rootPath: "Legacy|batch", rootName: "Old selection", folderRoots: [], status: "incomplete" },
            { kind: "file", rootPath: "Projects/b.txt", rootName: "b.txt", folderRoots: [], status: "complete" },
            { kind: "folder", rootPath: "Empty", rootName: "Empty", folderRoots: ["Empty"], status: "complete" }
          ];
          for (const root of roots) {
            const id = `retained-root:${root.kind}:${encodeURIComponent(root.rootPath)}`;
            index.roots[id] = { ...root, id, addedAt: new Date().toISOString(), completionProofVersion: 1 };
            if (root.rootName !== "Empty") index.memberships["Projects/b.txt"].push(id);
          }
          store.put(index, key);
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/ });
  await expect(settings.getByRole("button", { name: "Missing files", exact: true })).toBeVisible();
  await expect(settings.getByLabel("Saved offline")).toBeVisible();
  await expect(settings.getByLabel("No files saved")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Retry offline copy for Projects" })).toBeEnabled();
  await expect(settings.getByRole("button", { name: "Retry offline copy for Old selection" })).toHaveCount(0);
  await settings.locator(".offline-files-list").scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence(info.project.name, "compact-states") });
  const legacy = settings.getByRole("button", { name: "Incomplete", exact: true });
  if (info.project.name === "mobile-chrome") await legacy.tap(); else { await legacy.focus(); await legacy.press("Enter"); }
  await expect(settings.getByText(/Select the items again/)).toBeVisible();
  await page.screenshot({ path: evidence(info.project.name, "old-batch-explanation") });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((element) => element.clientWidth));
  const contrast = await settings.locator(".cache-summary").evaluate((element) => {
    const rgb = getComputedStyle(element).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = rgb.map((channel) => { const normalized = channel / 255; return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; });
    return 1.05 / (0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] + 0.05);
  });
  expect(contrast).toBeGreaterThan(4.5);
});
