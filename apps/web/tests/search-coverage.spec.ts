import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { connectAccount, openSettings, openWorkspaceAction } from "./support/workspace";

async function search(page: Page, query: string) {
  if (!await page.getByRole("textbox", { name: "Search files", exact: true }).isVisible()) await page.getByRole("button", { name: /Open search/i }).click();
  await page.getByRole("textbox", { name: "Search files", exact: true }).fill(query);
}

async function proof(page: Page, label: string, device: string, state: string) {
  const indicator = page.getByRole("button", { name: label, exact: true });
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Only part of this folder is listed", exact: true })).toHaveCount(0);
  const explanation = indicator.locator("..").locator("p");
  await expect(explanation).not.toBeVisible();
  await indicator.focus();
  await indicator.press("Enter");
  await expect(explanation).toBeVisible();
  await indicator.press("Enter");
  if (device === "mobile-chrome") await indicator.tap(); else await indicator.click();
  await expect(explanation).toBeVisible();
  const box = await explanation.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  await page.screenshot({ path: resolve(process.cwd(), `../../.tmp/agent-artifacts/search_coverage_implementation/${device}-${state}.png`) });
  await indicator.press("Enter");
}

test("bounded live search and saved fallback remain truthful and compact", async ({ page }, testInfo) => {
  const initial = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/files");
  await connectAccount(page, "Search coverage");
  const headers = await (await initial).allHeaders();
  await search(page, "roadmap");
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search incomplete", exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(process.cwd(), `../../.tmp/agent-artifacts/search_coverage_implementation/${testInfo.project.name}-complete.png`) });
  const create = async (path: string, name: string) => expect((await page.request.post("/api/folders", { headers, data: { path, name } })).status()).toBe(201);
  await create("", "Scope");
  for (let i = 0; i < 51; i += 1) await create("Scope", `folder-${i}`);
  for (let i = 0; i < 21; i += 1) expect((await page.request.post("/api/upload", { headers, data: { path: "Scope", name: `needle-${i}.txt`, contentBase64: "YQ==" } })).status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: /Open folder Scope/i }).click();
  const live = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/search" && new URL(response.url()).searchParams.get("q") === "needle");
  await search(page, "needle");
  expect(new URL((await live).url()).searchParams.get("coverage")).toBe("bounded-v1");
  expect((await (await live).json()).data).toMatchObject({ completeness: "partial", items: expect.any(Array) });
  await expect(page.locator(".file-list-items .item-name")).toHaveCount(20);
  await proof(page, "Search incomplete", testInfo.project.name, "partial");
  if (testInfo.project.name === "mobile-chrome") {
    await page.setViewportSize({ width: 320, height: 760 });
    await proof(page, "Search incomplete", testInfo.project.name, "partial-320");
    await page.getByRole("button", { name: "Close search", exact: true }).click();
    await proof(page, "Search incomplete", testInfo.project.name, "partial-320-closed-search");
    await page.getByRole("button", { name: "Open search", exact: true }).click();
    await page.setViewportSize({ width: 412, height: 839 });
  }
  await search(page, "absent");
  await expect(page.getByText("No matches in the searched portion.", { exact: true })).toBeVisible();
  await proof(page, "Search incomplete", testInfo.project.name, "partial-empty");
  await page.route("**/api/search?**", (route) => route.abort());
  await search(page, "");
  await expect(page.getByRole("button", { name: "Search incomplete", exact: true })).toHaveCount(0);
  await search(page, "needle");
  await expect(page.locator(".file-list-items .item-name")).toHaveCount(20);
  await proof(page, "Saved search results", testInfo.project.name, "saved");
  await search(page, "absent");
  await expect(page.getByText("No matches in saved results.", { exact: true })).toBeVisible();
  await proof(page, "Saved search results", testInfo.project.name, "saved-empty");
  await search(page, "uncached");
  await expect(page.getByText("Unable to load search results.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved search results", exact: true })).toHaveCount(0);
  await search(page, "needle");
  await expect(page.getByRole("button", { name: "Saved search results", exact: true })).toBeVisible();
  await page.unroute("**/api/search?**");
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Close search", exact: true }).click();
  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("second-search");
  await dialog.getByLabel("App password").fill("test-password");
  await dialog.getByLabel("Label").fill("Second search");
  await dialog.getByRole("button", { name: /Add account/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search incomplete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Saved search results", exact: true })).toHaveCount(0);
});

test("explicit offline search is local and makes no API requests", async ({ page }, testInfo) => {
  await connectAccount(page, "Local search");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Back to files/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  const transfer = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transfer.getByText(/^Done/)).toBeVisible();
  await transfer.getByRole("button", { name: /Close/i }).click();
  await openWorkspaceAction(page, /^Go offline$/i);
  const closeNavigation = page.getByRole("button", { name: /Close navigation menu/i }).last();
  if (await closeNavigation.isVisible()) await closeNavigation.click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await search(page, "roadmap");
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await proof(page, "Offline search", testInfo.project.name, "offline");
  await search(page, "absent");
  await expect(page.getByText("No matches in saved files.", { exact: true })).toBeVisible();
  await proof(page, "Offline search", testInfo.project.name, "offline-empty");
  expect(requests).toEqual([]);
});
