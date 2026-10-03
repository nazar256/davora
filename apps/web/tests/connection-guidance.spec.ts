import path from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { connectAccount, openSettings } from "./support/workspace";

const connectionHelp = "details.account-form-help";
const removalDetails = "details.account-removal-details";
const evidenceRoot = path.resolve(process.cwd(), "../../.tmp/agent-artifacts/implementation");

function evidencePath(testInfo: TestInfo, state: string) {
  return path.join(evidenceRoot, `p6-${testInfo.project.name}-${state}.png`);
}

async function captureEvidence(page: Page, testInfo: TestInfo, state: string, fullPage = false) {
  await page.screenshot({ path: evidencePath(testInfo, state), fullPage, animations: "disabled" });
}

async function assertAccessGuidanceAboveActions(page: Page, accessGuidance: Locator) {
  const formBox = await page.locator(".account-form").boundingBox();
  const actionsBox = await page.locator(".account-form > .dialog-actions").boundingBox();
  const accessBox = await accessGuidance.boundingBox();
  expect(formBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(accessBox).not.toBeNull();
  expect(accessBox!.y).toBeGreaterThanOrEqual(formBox!.y);
  expect(accessBox!.y + accessBox!.height).toBeLessThanOrEqual(actionsBox!.y - 1);
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("connection guidance stays closed, local, and secret-free across initial/add/reconnect flows", async ({ page, request, baseURL }, testInfo) => {
  let accountPosts = 0;
  page.on("request", (requestEvent) => {
    if (requestEvent.method() === "POST" && new URL(requestEvent.url()).pathname === "/api/accounts") accountPosts += 1;
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  await expect(page.getByText("Davora saves your app password encrypted on the server, not in browser storage.")).toBeVisible();
  await expect(page.getByLabel("Root folder")).toHaveAttribute("placeholder", "Default folder");

  const help = page.locator(connectionHelp);
  const summary = help.locator("summary");
  await expect(help).not.toHaveAttribute("open");
  await expect(summary).toHaveAttribute("aria-label", "Connection help");
  await summary.scrollIntoViewIfNeeded();
  await captureEvidence(page, testInfo, "initial-closed");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("open", "");
  await expect(help.getByText(/without a file or share link/i)).toBeVisible();
  await expect(help.getByText(/may differ from your display name/i)).toBeVisible();
  await expect(help.getByText(/Personal settings → Security/i)).toBeVisible();
  await expect(help.getByText(/Optional folder inside Nextcloud/i)).toBeVisible();
  await expect(help.getByText(/Remove the account to delete Davora’s saved password/i)).toBeVisible();
  await expect(help.getByRole("link", { name: /Nextcloud help/i })).toHaveAttribute(
    "href",
    "https://docs.nextcloud.com/server/stable/user_manual/en/session_management.html"
  );
  await expect(help.getByRole("link", { name: /Nextcloud help/i })).toHaveAttribute("target", "_blank");
  await expect(help.getByRole("link", { name: /Nextcloud help/i })).toHaveAttribute("rel", "noopener noreferrer");
  expect(accountPosts).toBe(0);
  await captureEvidence(page, testInfo, "help-top");
  const accessGuidance = help.getByText(/Remove the account to delete Davora’s saved password/i);
  await accessGuidance.scrollIntoViewIfNeeded();
  await expect(accessGuidance).toBeVisible();
  if (testInfo.project.name === "mobile-chrome") {
    await assertAccessGuidanceAboveActions(page, accessGuidance);
  }
  await captureEvidence(page, testInfo, "help-access");
  expect(await help.innerText()).not.toContain("synthetic-password-sentinel");

  await page.keyboard.press("Space");
  await expect(help).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: /^Connect account$/i })).toBeVisible();
  expect(accountPosts).toBe(0);

  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("guidance-primary");
  await page.getByLabel("App password").fill("synthetic-password-sentinel");
  await page.getByLabel("Label").fill("Guidance primary");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await settings.getByRole("button", { name: /Add account/i }).click();
  const addDialog = page.getByRole("dialog", { name: /Add account/i });
  await expect(addDialog.getByText("Connect another Nextcloud account.")).toBeVisible();
  await expect(addDialog.locator(connectionHelp)).not.toHaveAttribute("open");
  await captureEvidence(page, testInfo, "add-closed");
  await addDialog.getByRole("button", { name: "Cancel" }).click();

  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: /Reconnect Guidance primary/i })).toBeVisible();
  await expect(page.getByText("Enter an app password to restore access.")).toBeVisible();
  await expect(page.locator(connectionHelp)).not.toHaveAttribute("open");
  expect(await page.locator("body").innerText()).not.toContain("synthetic-password-sentinel");
  await captureEvidence(page, testInfo, "reconnect-closed");
});

test("connection error and removal guidance preserve privacy and provider boundaries", async ({ page }, testInfo) => {
  const rawError = "raw-provider-error-synthetic-password-sentinel";
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: rawError } })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("error-user");
  await page.getByLabel("App password").fill(rawError);
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByText("Unable to connect account.")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(rawError);
  expect(await page.locator(connectionHelp).innerText()).not.toContain(rawError);
  await captureEvidence(page, testInfo, "sanitized-error");

  await page.unroute("**/api/accounts");
  await connectAccount(page, "Removal guidance");
  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /^Remove$/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Removal guidance/i });
  await expect(removeDialog.getByText(/Your Nextcloud files stay unchanged/i)).toBeVisible();
  const details = removeDialog.locator(removalDetails);
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.getByText(/saved app password/i)).toBeVisible();
  await expect(details.getByText(/Revoke the app password in Nextcloud Security/i)).toBeVisible();
  await captureEvidence(page, testInfo, "removal-details-open");
});

test("mobile connection help fits the scrollable form and leaves sticky actions usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile connection guidance geometry.");
  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  const form = page.locator(".account-form");
  const help = page.locator(connectionHelp);
  await help.locator("summary").tap();
  await expect(help).toHaveAttribute("open", "");
  await expect(help.getByText(/Optional folder inside Nextcloud/i)).toBeVisible();
  const accessGuidance = help.getByText(/Remove the account to delete Davora’s saved password/i);
  await accessGuidance.scrollIntoViewIfNeeded();
  await expect(accessGuidance).toBeVisible();
  await assertAccessGuidanceAboveActions(page, accessGuidance);

  const formBox = await form.boundingBox();
  const actionsBox = await page.locator(".account-form > .dialog-actions").boundingBox();
  expect(formBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(actionsBox!.x).toBeGreaterThanOrEqual(0);
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  await expect(page.getByRole("button", { name: /^Connect account$/i })).toBeVisible();
  await captureEvidence(page, testInfo, "touch-help-access");
});
