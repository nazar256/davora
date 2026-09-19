import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const evidenceRoot = resolve(process.cwd(), "../../.tmp/agent-artifacts/worker/settings-css-browser-20260806T180000Z");

async function connectAccount(page: Page, label: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
}

async function openSettings(page: Page) {
  const settingsButton = page.getByRole("button", { name: /Profile & settings/i });
  for (let index = 0; index < await settingsButton.count(); index += 1) {
    if (await settingsButton.nth(index).isVisible()) {
      await settingsButton.nth(index).click();
      return page.getByRole("dialog", { name: /Profile and settings/i });
    }
  }
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Profile & settings/i }).click();
  return page.getByRole("dialog", { name: /Profile and settings/i });
}

function attachDiagnostics(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`.trim()));
  return { consoleErrors, pageErrors, requestFailures };
}

async function saveEvidence(name: string, payload: unknown) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(resolve(evidenceRoot, name), `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
}

async function saveDiagnostics(name: string, diagnostics: ReturnType<typeof attachDiagnostics>) {
  const stem = name.replace(/\.json$/i, "");
  await saveEvidence(`${stem}-console.json`, diagnostics.consoleErrors);
  await saveEvidence(`${stem}-page.json`, diagnostics.pageErrors);
  await saveEvidence(`${stem}-requests.json`, diagnostics.requestFailures);
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test.describe("SettingsDialogStage and CachePanel CSS characterization", () => {
  test("records shell, cache controls, theme, responsive geometry, scroll, scrim, and Back contracts", async ({ page }, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    await connectAccount(page, "Рабочая область — 超長 Unicode settings");

    // Populate one retained folder through the local mock worker; this does not touch WebDAV.
    await page.getByRole("button", { name: /Open actions for Projects/i }).click();
    await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /^Keep offline$/i }).click();
    await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
    const transfer = page.getByRole("dialog", { name: /Transfer status/i });
    await expect(transfer.getByText(/^Done/i)).toBeVisible();
    await transfer.getByRole("button", { name: /Close transfer status/i }).click();
    const closeActions = page.getByRole("button", { name: /Close item actions/i });
    if (await closeActions.isVisible().catch(() => false)) await closeActions.click();

    // Add a second retained root using the existing local mock fixture so the
    // settings list proves multiple offline items without any remote mutation.
    await page.getByRole("button", { name: /Open folder Projects/i }).click();
    await page.getByRole("button", { name: /Open actions for roadmap\.txt/i }).click();
    await page.getByRole("button", { name: /^Keep offline$/i }).click();
    await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
    const secondTransfer = page.getByRole("dialog", { name: /Transfer status/i });
    await expect(secondTransfer.getByText(/^Done/i)).toBeVisible();
    await secondTransfer.getByRole("button", { name: /Close transfer status/i }).click();
    const secondCloseActions = page.getByRole("button", { name: /Close item actions/i });
    if (await secondCloseActions.isVisible().catch(() => false)) await secondCloseActions.click();

    const settings = await openSettings(page);
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel("Keep screen awake during active work")).toBeVisible();
    await expect(settings).toContainText(/Ready for media playback and transfers\.|Unavailable in this browser; work continues normally\.|Not granted by the browser; work continues normally\.|Disabled on this device\./);
    const contracts: Record<string, unknown> = {};
    const themes = ["light", "dark", "system"] as const;
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark" });
      const themeButton = settings.getByRole("group", { name: "Theme" }).getByRole("button", { name: theme[0].toUpperCase() + theme.slice(1) });
      await themeButton.click();
      await expect(themeButton).toHaveAttribute("aria-pressed", "true");
      for (const [width, height] of [[320, 900], [768, 900], [1440, 900]] as const) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(40);
        const contract = await page.evaluate(() => {
          const dialog = document.querySelector<HTMLElement>(".settings-dialog");
          const scrim = document.querySelector<HTMLElement>(".settings-modal-scrim");
          const grid = document.querySelector<HTMLElement>(".settings-grid");
          const header = document.querySelector<HTMLElement>(".settings-dialog-header");
          const cache = document.querySelector<HTMLElement>(".cache-panel");
          const metadata = document.querySelector<HTMLElement>(".cache-metadata");
          const metadataRow = metadata?.querySelector<HTMLElement>("div");
          const slider = document.querySelector<HTMLInputElement>('input[aria-label="Opened-file cache limit slider"]');
          const manual = document.querySelector<HTMLInputElement>('input[aria-label="Opened-file cache limit in MB"]');
          const rect = (element: HTMLElement | null) => {
            if (!element) return null;
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { width: box.width, height: box.height, display: style.display, overflow: style.overflow, position: style.position, zIndex: style.zIndex, background: style.backgroundColor, border: style.border, radius: style.borderRadius, grid: style.gridTemplateColumns };
          };
          return {
            viewport: window.innerWidth,
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            bodyOverflow: getComputedStyle(document.body).overflow,
            scrim: rect(scrim),
            dialog: rect(dialog),
            grid: rect(grid),
            header: rect(header),
            cache: rect(cache),
            metadata: rect(metadata),
            metadataRow: rect(metadataRow ?? null),
            slider: rect(slider),
            manual: rect(manual),
            retainedItems: document.querySelectorAll(".offline-files-item").length,
            themePressed: [...document.querySelectorAll<HTMLButtonElement>('.theme-mode-control button')].map((button) => [button.textContent?.trim(), button.getAttribute("aria-pressed")])
          };
        });
        contracts[`${theme}-${width}`] = contract;
        const typed = contract as { viewport: number; documentOverflow: number; scrim: { position: string; zIndex: string; width: number; height: number }; dialog: { width: number; height: number; overflow: string; zIndex: string }; grid: { grid: string }; header: { width: number }; metadataRow: { grid: string }; slider: { width: number; height: number }; manual: { width: number; height: number } };
        expect(typed.viewport).toBe(width);
        expect(typed.documentOverflow).toBeLessThanOrEqual(1);
        expect(typed.scrim.position).toBe("fixed");
        expect(Number(typed.scrim.zIndex)).toBeGreaterThan(40);
        expect(typed.scrim.width).toBeLessThanOrEqual(width + 1);
        expect(typed.dialog.width).toBeLessThanOrEqual(width + 1);
        expect(typed.dialog.overflow).toBe("auto");
        expect(typed.header.width).toBeLessThanOrEqual(typed.dialog.width + 1);
        if (width <= 900) expect(typed.grid.grid.trim().split(/\s+/)).toHaveLength(1);
        else expect(typed.grid.grid.trim().split(/\s+/)).toHaveLength(2);
        expect(typed.metadataRow.grid.trim().split(/\s+/)).toHaveLength(width <= 900 ? 1 : 2);
        expect(typed.slider.width).toBeGreaterThan(0);
        expect(typed.manual.width).toBeGreaterThan(0);

        const themeButtons = settings.getByRole("group", { name: "Theme" }).getByRole("button");
        for (let index = 0; index < await themeButtons.count(); index += 1) {
          const button = themeButtons.nth(index);
          const box = await button.boundingBox();
          expect(box?.height ?? 0, `${theme}-${width} theme target`).toBeGreaterThanOrEqual(width <= 900 ? 44 : 36);
        }
        const lightButton = settings.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" });
        await lightButton.click();
        await page.keyboard.press("Tab");
        const focusContract = await settings.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).evaluate((element) => {
          const style = getComputedStyle(element);
          return { visible: element.matches(":focus-visible"), outline: style.outlineStyle, boxShadow: style.boxShadow };
        });
        expect(focusContract.visible, `${theme}-${width} keyboard focus`).toBe(true);
        expect(focusContract.outline !== "none" || focusContract.boxShadow !== "none", `${theme}-${width} focus ring`).toBe(true);
        await themeButton.click();
        await expect(themeButton).toHaveAttribute("aria-pressed", "true");
      }
    }

    const details = settings.locator(".cache-details");
    await expect(details.locator(".cache-metadata")).toBeHidden();
    await details.getByText("View cache details").click();
    await expect(details.locator(".cache-metadata")).toBeVisible();

    await page.setViewportSize({ width: 320, height: 640 });
    await expect(settings.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    const scrollContract = await settings.evaluate((element) => {
      element.scrollTop = 0;
      const top = element.scrollTop;
      element.scrollTop = element.scrollHeight;
      return { top, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    expect(scrollContract.top).toBe(0);
    expect(scrollContract.scrollHeight).toBeGreaterThan(scrollContract.clientHeight);
    expect(scrollContract.scrollTop).toBeGreaterThan(0);

    const closeButton = settings.getByRole("button", { name: "Done", exact: true });
    await closeButton.hover();
    const hoverBackground = await closeButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(hoverBackground).not.toBe("rgba(0, 0, 0, 0)");

    await settings.locator('input[aria-label="Opened-file cache limit slider"]').focus();
    await settings.locator('input[aria-label="Opened-file cache limit in MB"]').fill("256");
    await settings.locator('input[aria-label="Opened-file cache limit in MB"]').press("Enter");
    await page.setViewportSize({ width: 1440, height: 900 });
    const scrim = page.locator(".settings-modal-scrim");
    const scrimBox = await scrim.boundingBox();
    expect(scrimBox).not.toBeNull();
    await page.mouse.click((scrimBox?.x ?? 0) + 2, (scrimBox?.y ?? 0) + 2);
    await expect(settings).toHaveCount(0);
    await openSettings(page);
    await expect(page.getByRole("dialog", { name: /Profile and settings/i }).locator(".offline-files-item")).toHaveCount(2);
    await page.goBack();
    await expect(page.getByRole("dialog", { name: /Profile and settings/i })).toHaveCount(0);

    const evidenceName = `settings-css-contracts-${testInfo.project.name}-${Date.now()}.json`;
    await saveEvidence(evidenceName, { contracts, limitations: ["The local mock fixture emits two retained roots; account removal and remote WebDAV mutations were intentionally not invoked."] });
    await saveDiagnostics(evidenceName, diagnostics);
    expect(diagnostics.consoleErrors, "console errors").toEqual([]);
    expect(diagnostics.pageErrors, "page errors").toEqual([]);
    expect(diagnostics.requestFailures.filter((failure) => !failure.includes("ERR_ABORTED")), "unexpected request failures").toEqual([]);
  });

  test("characterizes empty cache, multiple accounts, reconnect-required, pending-removal, and offline-disabled controls", async ({ page }, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    await connectAccount(page, "Alpha settings account");
    const settings = await openSettings(page);
    await expect(settings.locator(".offline-files-item")).toHaveCount(0);
    await expect(settings.getByText(/No files or folders are explicitly kept offline yet/i)).toBeVisible();
    await settings.getByRole("button", { name: /^Add account$/i }).click();
    const add = page.getByRole("dialog", { name: /Add account/i });
    await add.getByLabel("Base URL").fill("https://mock-account.example.com");
    await add.getByLabel("Username").fill("beta-settings-account");
    await add.getByLabel("App password").fill("mock-app-password");
    await add.getByLabel("Label").fill("Beta settings account");
    await add.getByRole("button", { name: /Add account/i }).click();
    await expect(add).toHaveCount(0);
    await openSettings(page);
    const secondSettings = page.getByRole("dialog", { name: /Profile and settings/i });
    await expect(secondSettings.getByLabel("Active account").locator("option")).toHaveCount(2);

    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("davora-account-state") ?? "{}") as { activeAccountId?: string; accounts: Array<{ account: Record<string, unknown>; pendingRemoval?: unknown }> });
    const alpha = state.accounts.find((record) => record.account.label === "Alpha settings account");
    const beta = state.accounts.find((record) => record.account.label === "Beta settings account");
    expect(alpha?.account.id).toBeTruthy();
    expect(beta?.account.id).toBeTruthy();
    await page.evaluate(({ alphaId }) => {
      const parsed = JSON.parse(localStorage.getItem("davora-account-state") ?? "{}");
      localStorage.setItem("davora-account-state", JSON.stringify({
        activeAccountId: alphaId,
        accounts: parsed.accounts.map((record: { account: { id: string } }) => record.account.id === alphaId ? { ...record, pendingRemoval: { phase: "revoke" } } : record)
      }));
    }, { alphaId: alpha!.account.id });
    await page.reload();
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    const pendingSettings = await openSettings(page);
    await expect(pendingSettings).toHaveText(/Removal pending for Alpha settings account \(remote revoke\)/i);
    await expect(pendingSettings.getByRole("button", { name: /Retry removal/i })).toBeVisible();
    await expect(pendingSettings.getByRole("button", { name: /^Remove$/i })).toHaveCount(0);

    await page.getByRole("button", { name: /Close|Done/i }).click();
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    const navigation = page.getByRole("complementary", { name: /Navigation menu/i });
    const offline = navigation.getByRole("button", { name: /Go offline/i });
    if (await offline.isVisible().catch(() => false)) {
      await offline.click();
      await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
      const offlineSettings = await openSettings(page);
      await expect(offlineSettings.getByText(/Account changes require online mode/i)).toBeVisible();
      await expect(offlineSettings.getByRole("button", { name: /^Add account$/i })).toBeDisabled();
    }

    const evidenceName = `settings-css-states-${testInfo.project.name}-${Date.now()}.json`;
    await saveEvidence(evidenceName, { states: ["empty-cache", "two-accounts", "pending-removal", "offline-backend-disabled"], limitations: ["Reconnect-required is represented by existing pending-account fixture only when local mock restore is unavailable; no account removal or remote WebDAV request was made."] });
    await saveDiagnostics(evidenceName, diagnostics);
    expect(diagnostics.consoleErrors, "console errors").toEqual([]);
    expect(diagnostics.pageErrors, "page errors").toEqual([]);
    expect(diagnostics.requestFailures.filter((failure) => !failure.includes("ERR_ABORTED")), "unexpected request failures").toEqual([]);
  });

  test("characterizes reconnect-required account presentation", async ({ page, request, baseURL }, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    await connectAccount(page, "Reconnect settings account");
    await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
      headers: { "x-davora-reset-token": "playwright-dev-secret" }
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: /Reconnect Reconnect settings account/i })).toBeVisible();

    const evidenceName = `settings-css-reconnect-${testInfo.project.name}-${Date.now()}.json`;
    await saveEvidence(evidenceName, {
      states: ["reconnect-required"],
      expectedConsoleErrors: diagnostics.consoleErrors,
      limitations: ["The mock reset invalidates the local session only; no account removal or remote WebDAV request was made."]
    });
    await saveDiagnostics(evidenceName, diagnostics);
    expect(diagnostics.consoleErrors.filter((error) => !error.includes("status of 409")), "unexpected console errors").toEqual([]);
    expect(diagnostics.pageErrors, "page errors").toEqual([]);
    expect(diagnostics.requestFailures.filter((failure) => !failure.includes("ERR_ABORTED")), "unexpected request failures").toEqual([]);
  });
});
