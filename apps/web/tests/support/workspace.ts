import { expect, type Page } from "@playwright/test";

export async function connectAccount(page: Page, label = "Mock workspace", options: { waitForWorkspace?: boolean } = {}) {
  const { waitForWorkspace = true } = options;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /Connect account/i }).click();
  if (waitForWorkspace) await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
}

export async function clickVisibleButton(page: Page, name: RegExp): Promise<boolean> {
  const buttons = page.getByRole("button", { name });
  for (let index = 0; index < await buttons.count(); index += 1) {
    if (await buttons.nth(index).isVisible()) {
      await buttons.nth(index).click();
      return true;
    }
  }
  return false;
}

export async function openWorkspaceAction(page: Page, name: RegExp): Promise<void> {
  if (await clickVisibleButton(page, name)) return;
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  if (!await clickVisibleButton(page, name)) throw new Error("Workspace action " + name + " is unavailable in both the toolbar and navigation drawer.");
}

export async function openSettings(page: Page): Promise<void> {
  await openWorkspaceAction(page, /Profile & settings/i);
}

export function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

export async function selectFileListEntry(page: Page, checkboxName: RegExp, openButtonName: RegExp) {
  const checkbox = page.getByRole("checkbox", { name: checkboxName });
  if (await checkbox.isVisible()) {
    await checkbox.click();
    return;
  }

  const openButton = page.getByRole("button", { name: openButtonName });
  const openButtonHandle = await openButton.elementHandle();
  expect(openButtonHandle).not.toBeNull();
  await openButtonHandle!.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await openButtonHandle!.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
}

export async function getVisibleSelectionToolbar(page: Page) {
  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  return await toolbar.isVisible().catch(() => false) ? toolbar : undefined;
}
