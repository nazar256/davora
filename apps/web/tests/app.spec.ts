import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { connectAccount } from "./support/workspace";
import "./app-cross-feature";

const appTestDirectory = path.dirname(fileURLToPath(import.meta.url));
const movedAppSource = readFileSync(path.resolve(appTestDirectory, "app-cross-feature.ts"), "utf8");
const movedAppTitles = [
  "PER-71 browser surfaces stay compact, themed, and truthful about offline availability",
  "account and mutation dialogs preserve scrim and Back dismissal parity",
  "PER-73 mobile forms, sheets, and dialogs keep primary actions reachable at 360x640",
  "mobile shell keeps account and status details behind profile and settings"
] as const;

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("app composition keeps account bootstrap connected to the workspace surface", async ({ page }) => {
  await connectAccount(page, "App composition smoke");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page).toHaveURL(/path=Projects/);
});

test("app browser ownership keeps feature scenarios outside the root entrypoint", () => {
  const rootSource = readFileSync(path.resolve(appTestDirectory, "app.spec.ts"), "utf8");
  for (const title of movedAppTitles) {
    expect(rootSource.split(`test("${title}"`).length - 1, title).toBe(0);
    expect(movedAppSource.split(`test("${title}"`).length - 1, title).toBe(1);
  }
  expect(rootSource.split(/\r?\n/u).length).toBeLessThanOrEqual(200);
});
