import { expect, test, type Locator, type Page } from "@playwright/test";

import { connectAccount } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

async function openFolderShortcutDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("button", { name: /Folder shortcut/i }).click();
  const dialog = page.getByRole("dialog", { name: "Folder shortcut" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function enableFolderAppShortcuts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "davora-ui-settings",
      JSON.stringify({ experimentalFolderAppShortcutsEnabled: true })
    );
  });
}

async function readLinkAccountId(link: string): Promise<string> {
  const account = new URL(link).searchParams.get("account");
  expect(account).toBeTruthy();
  return account as string;
}

test("folder shortcut dialog copies an account-aware deep link without credentials", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectAccount(page, "Shortcut workspace");

  const dialog = await openFolderShortcutDialog(page);
  const linkInput = dialog.getByLabel("Folder link");
  const link = await linkInput.inputValue();
  const url = new URL(link);
  expect(url.searchParams.get("path")).toBe("Projects");
  expect(await readLinkAccountId(link)).toBeTruthy();
  expect(link).not.toContain("mock-app-password");
  // The experimental app-install affordance stays hidden while the setting is off.
  await expect(dialog.getByRole("button", { name: "Shortcut as app" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Copy folder link" }).click();
  await expect(dialog.getByText("Link copied to the clipboard.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
});

test("shortcut action is offered for folders only", async ({ page }) => {
  await connectAccount(page, "Shortcut workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap\.txt/i }).click();

  const details = page.getByRole("region", { name: /Details for roadmap\.txt/i });
  await expect(details).toBeVisible();
  await expect(page.getByRole("button", { name: /Folder shortcut/i })).toHaveCount(0);
});

test("folder shortcut dialog dismisses through browser Back", async ({ page }) => {
  await connectAccount(page, "Shortcut workspace");
  const dialog = await openFolderShortcutDialog(page);
  await expect(dialog).toBeVisible();

  await page.evaluate(() => history.back());
  await expect(dialog).toBeHidden();
});

test("folder deep link restores the folder under the linked account", async ({ page }) => {
  await connectAccount(page, "Shortcut workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap\.txt/i })).toBeVisible();

  const linkedUrl = new URL(page.url());
  expect(linkedUrl.searchParams.get("path")).toBe("Projects");
  const accountId = linkedUrl.searchParams.get("account");
  expect(accountId).toBeTruthy();

  await page.goto(`/?path=Projects&account=${accountId}`);
  await expect(page.getByRole("button", { name: /Open file roadmap\.txt/i })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("account")).toBe(accountId);
});

test("deep link with an unavailable account stays at root and warns", async ({ page }) => {
  await page.addInitScript(() => {
    const log: Array<string | null> = [];
    (window as unknown as { __statusLog: Array<string | null> }).__statusLog = log;
    const observer = new MutationObserver(() => {
      const note = document.querySelector(".browse-status-note");
      if (note && log[log.length - 1] !== note.textContent) {
        log.push(note.textContent);
      }
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true });
  });
  await connectAccount(page, "Shortcut workspace");

  await page.goto("/?path=Projects&account=missing-account");

  // The linked folder is suppressed and the workspace stays at the root.
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("path")).not.toBe("Projects");
  const statusLog = await page.evaluate(
    () => (window as unknown as { __statusLog: Array<string | null> }).__statusLog
  );
  expect(statusLog.some((note) => note?.includes("linked account is unavailable"))).toBe(true);
});

test("experimental folder app install swaps the manifest link during the prompt", async ({ page }) => {
  await enableFolderAppShortcuts(page);
  await connectAccount(page, "Shortcut workspace");

  const manifestHrefBefore = await page.evaluate(
    () => document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null
  );

  await page.evaluate(() => {
    const installEvent = new Event("beforeinstallprompt");
    Object.defineProperty(installEvent, "prompt", {
      value: async () => {
        const href = document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null;
        (window as unknown as { __folderManifest: unknown }).__folderManifest = {
          href,
          manifest: href ? await (await fetch(href)).json() : null
        };
      }
    });
    Object.defineProperty(installEvent, "userChoice", {
      value: Promise.resolve({ outcome: "accepted" })
    });
    window.dispatchEvent(installEvent);
  });

  const dialog = await openFolderShortcutDialog(page);
  await dialog.getByRole("button", { name: "Shortcut as app" }).click();
  await expect(dialog.getByText("Folder app installed.")).toBeVisible();

  const captured = await page.evaluate(
    () => (window as unknown as { __folderManifest: { href: string | null; manifest: { start_url: string; id: string; display: string } | null } }).__folderManifest
  );
  expect(captured.href).toMatch(/^blob:/);
  expect(captured.manifest?.display).toBe("standalone");
  const startUrl = new URL(captured.manifest?.start_url ?? "");
  expect(startUrl.searchParams.get("path")).toBe("Projects");
  expect(startUrl.searchParams.get("account")).toBeTruthy();
  expect(captured.manifest?.id).toBe(captured.manifest?.start_url);

  const manifestHrefAfter = await page.evaluate(
    () => document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null
  );
  expect(manifestHrefAfter).toBe(manifestHrefBefore);
});

test("experimental install falls back to the manual link when the browser cannot install", async ({ page }) => {
  await enableFolderAppShortcuts(page);
  await connectAccount(page, "Shortcut workspace");

  const dialog = await openFolderShortcutDialog(page);
  await dialog.getByRole("button", { name: "Shortcut as app" }).click();

  await expect(dialog.getByText("Install is not available in this browser.")).toBeVisible();
  await expect(page.locator(".browse-status-note")).toContainText(/cannot install a folder app/i);
  const link = await dialog.getByLabel("Folder link").inputValue();
  expect(link).toContain("path=Projects");
});
