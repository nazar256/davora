import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAccount } from "./support/workspace";

const evidencePath = (device: string, state: string) => resolve(process.cwd(), `../../.tmp/agent-artifacts/implementation/c01-${device}-${state}.png`);

async function verifyDisclosure(page: Page, trigger: Locator, device: string, state: string) {
  const disclosure = trigger.locator("..");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(disclosure.locator("p")).toBeVisible();
  await trigger.press("Enter");
  await expect(disclosure.locator("p")).not.toBeVisible();
  if (device === "mobile-chrome") await trigger.tap(); else await trigger.click();
  await expect(disclosure.locator("p")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((element) => element.clientWidth));
  const box = await disclosure.locator("p").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: evidencePath(device, state) });
}

test("partial listing is visible and still permits choosing a direct destination", async ({ page }, testInfo) => {
  let partial = false;
  await page.route("**/api/files?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("listing")).toBe("complete-v1");
    const response = await route.fetch();
    const body = await response.json();
    if (partial && body.data) body.data.completeness = "partial";
    await route.fulfill({ response, json: body });
  });
  await connectAccount(page, "Listing completeness");
  await expect(page.getByRole("button", { name: "Only part of this folder is listed", exact: true })).toHaveCount(0);
  await page.screenshot({ path: evidencePath(testInfo.project.name, "complete") });
  partial = true;
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const indicator = page.getByRole("button", { name: "Only part of this folder is listed", exact: true });
  await expect(indicator).toBeVisible();
  await verifyDisclosure(page, indicator, testInfo.project.name, "partial-disclosure");
  await indicator.press("Enter");
  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByText("4+ items in /Projects", { exact: true })).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).not.toBeVisible();
  }
  await page.screenshot({ path: evidencePath(testInfo.project.name, "partial") });
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("region", { name: /Details for roadmap.txt/i }).getByRole("button", { name: /Copy or move/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(dialog.getByRole("button", { name: "Only part of this folder is listed", exact: true })).toBeVisible();
  const destinationDisclosure = dialog.getByRole("button", { name: "Only part of this folder is listed", exact: true });
  await verifyDisclosure(page, destinationDisclosure, testInfo.project.name, "destination-disclosure");
  await expect(dialog.getByText("Some items may be missing. Open a smaller folder or select individual files.", { exact: true })).toBeVisible();
  const destinationBox = await dialog.locator("details[open] p").boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(destinationBox?.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(destinationBox!.x + destinationBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((element) => element.clientWidth));
  await page.screenshot({ path: evidencePath(testInfo.project.name, "destination-disclosure") });
  await destinationDisclosure.press("Enter");
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeEnabled();
  await page.screenshot({ path: evidencePath(testInfo.project.name, "destination-partial") });
  const copyRequests: unknown[] = [];
  await page.route("**/api/copy", async (route) => {
    copyRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { data: { message: "Hidden destination collision", code: "conflict" } } });
  });
  await dialog.getByRole("button", { name: /^Copy here$/i }).click();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(page.getByText(/Hidden destination collision/).first()).toBeVisible();
  expect(copyRequests).toHaveLength(1);
  expect(copyRequests[0]).toMatchObject({ overwrite: false });
});

test("legacy saved listings remain visible with an unverified indication", async ({ page }, testInfo) => {
  await connectAccount(page, "Legacy listing");
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("davora-cache:v2:folder:")) continue;
      const value = JSON.parse(localStorage.getItem(key)!);
      delete value.completeness;
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
  await page.route("**/api/files?*", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  const indicator = page.getByRole("button", { name: "Saved listing has not been verified", exact: true });
  await expect(indicator).toBeVisible();
  await verifyDisclosure(page, indicator, testInfo.project.name, "unknown-disclosure");
  await expect(indicator.locator("..").locator("p")).toHaveText("This saved listing predates completeness checks. Reconnect to verify it.");
  await indicator.press("Enter");
  await page.screenshot({ path: evidencePath(testInfo.project.name, "unknown") });
});

test("cached clients get ordinary folders and actionable updates for partial folders", async ({ page }) => {
  const initialListing = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/files");
  await connectAccount(page, "Legacy protocol");
  const headers = await (await initialListing).allHeaders();
  const complete = await page.request.get("/api/files?path=Projects", { headers });
  expect(complete.status()).toBe(200);
  const completeBody: unknown = await complete.json();
  expect(completeBody).toEqual({ data: { path: "Projects", items: expect.any(Array) } });
  const folder = await page.request.post("/api/folders", { headers, data: { path: "", name: "Bounded" } });
  expect(folder.status()).toBe(201);
  for (let index = 0; index < 201; index += 1) {
    const created = await page.request.post("/api/folders", { headers, data: { path: "Bounded", name: `item-${index}` } });
    expect(created.status()).toBe(201);
  }
  const legacy = await page.request.get("/api/files?path=Bounded", { headers });
  expect(legacy.status()).toBe(426);
  expect(await legacy.json()).toEqual({ data: { code: "invalid_request", message: "Reopen Davora and apply the app update to open this folder safely." } });
  const current = await page.request.get("/api/files?path=Bounded&listing=complete-v1", { headers });
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({ data: { path: "Bounded", completeness: "partial" } });
});
