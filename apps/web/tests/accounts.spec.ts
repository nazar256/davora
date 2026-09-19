import { expect, test, type Page } from "@playwright/test";
import { connectAccount, openSettings } from "./support/workspace";

async function submitInitialAccountForm(page: Page, label: string, appPassword: string) {
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill(appPassword);
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /^Connect account$/i }).click();
}

async function expectSentinelsAbsent(page: Page, sentinels: readonly string[]) {
  const bodyText = await page.locator("body").innerText();
  const accountStorage = await page.evaluate(() => localStorage.getItem("davora-account-state") ?? "");
  for (const sentinel of sentinels) {
    expect(bodyText).not.toContain(sentinel);
    expect(accountStorage).not.toContain(sentinel);
  }
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
})
test("first run connects an account and preserves the file-manager workspace", async ({ page }) => {
  await connectAccount(page, "Primary workspace");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("normalized API")).toBeVisible();
  await expect(preview.getByRole("button", { name: /Back to files/i })).toBeVisible();
  await expect(preview.getByRole("button", { name: /Close preview/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Offline cache/i })).toHaveCount(0);
})

test("reload restores workspace access instead of dropping into reconnect when account metadata survives", async ({ page }) => {
  await connectAccount(page, "Restore workspace");
  await page.evaluate(() => {
    const raw = localStorage.getItem("davora-account-state");
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as {
      activeAccountId?: string;
      accounts: Array<{ account: unknown; session?: unknown }>;
    };
    localStorage.setItem("davora-account-state", JSON.stringify({
      activeAccountId: parsed.activeAccountId,
      accounts: parsed.accounts.map((record) => ({ account: record.account }))
    }));
  });

  await page.reload();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Reconnect/i })).toHaveCount(0);
})

test("account registry wiring repairs expired secret-bearing persisted sessions before restore", async ({ page }) => {
  const sentinels = ["expired-token-sentinel", "persisted-password-sentinel", "unknown-root-secret-sentinel"];
  await connectAccount(page, "Registry restore workspace");
  await page.evaluate(([expiredToken, password, rootSecret]) => {
    const raw = localStorage.getItem("davora-account-state");
    if (!raw) throw new Error("Expected account registry state");
    const parsed = JSON.parse(raw) as { activeAccountId?: string; accounts: Array<{ account: Record<string, unknown>; session?: Record<string, unknown> }> };
    localStorage.setItem("davora-account-state", JSON.stringify({
      ...parsed,
      unknownSecret: rootSecret,
      accounts: parsed.accounts.map((record) => ({
        ...record,
        account: { ...record.account, appPassword: password },
        session: { ...record.session, token: expiredToken, expiresAt: "2020-01-01T00:00:00.000Z", unknownSecret: rootSecret }
      }))
    }));
  }, sentinels);

  await page.reload();

  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("davora-account-state") ?? "")).not.toContain(sentinels[0]);
  await expectSentinelsAbsent(page, sentinels);
  const repaired = await page.evaluate(() => JSON.parse(localStorage.getItem("davora-account-state") ?? "{}") as {
    unknownSecret?: string;
    accounts?: Array<{ account?: { appPassword?: string }; session?: { token?: string; expiresAt?: string; unknownSecret?: string } }>;
  });
  expect(repaired.unknownSecret).toBeUndefined();
  expect(repaired.accounts?.[0]?.account?.appPassword).toBeUndefined();
  expect(repaired.accounts?.[0]?.session?.token).not.toBe("expired-token-sentinel");
  expect(Date.parse(repaired.accounts?.[0]?.session?.expiresAt ?? "")).toBeGreaterThan(Date.now());
})

test("account registry wiring blocks credential entry when registry reads are unavailable", async ({ page }) => {
  const rawError = "registry-read-secret-sentinel";
  await page.addInitScript((sentinel) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === "davora-account-state") throw new Error(sentinel);
      return original.call(this, key);
    };
  }, rawError);
  let connectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/accounts") connectPosts += 1;
  });

  await page.goto("/");

  await expect(page.getByText("Saved account data is unavailable. Restore browser storage access, then reload Davora.")).toBeVisible();
  await expect(page.getByLabel(/Base URL|Username|App password/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Connect account/i })).toHaveCount(0);
  expect(connectPosts).toBe(0);
  expect(await page.locator("body").innerText()).not.toContain(rawError);
})

test("account registry wiring clears credentials after remote success with one failed registry write", async ({ page }) => {
  const requestSentinel = "write-failure-request-password-sentinel";
  const storageSentinel = "registry-write-secret-sentinel";
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  await page.addInitScript((sentinel) => {
    const original = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "davora-account-state" && !failed) {
        failed = true;
        throw new Error(sentinel);
      }
      return original.call(this, key, value);
    };
  }, storageSentinel);
  let sessionPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/session") sessionPosts += 1;
  });
  await page.goto("/");

  await submitInitialAccountForm(page, "Write failure workspace", requestSentinel);

  await expect(page.getByText("The account connected remotely, but could not be saved in this browser.")).toBeVisible();
  await expect(page.getByLabel("App password")).toHaveValue("");
  expect(sessionPosts).toBe(0);
  await expectSentinelsAbsent(page, [requestSentinel, storageSentinel]);
  expect(consoleMessages.join("\n")).not.toMatch(new RegExp(`${requestSentinel}|${storageSentinel}`));
})

for (const responseKind of ["invalid JSON", "empty body"] as const) {
  test(`account registry wiring clears credentials after a malformed 201 ${responseKind}`, async ({ page }) => {
    const requestSentinel = `${responseKind.replaceAll(" ", "-")}-request-password-sentinel`;
    const responseSentinel = "malformed-response-secret-sentinel";
    const consoleMessages: string[] = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: responseKind === "invalid JSON" ? `{"secret":"${responseSentinel}"` : ""
      });
    });
    let sessionPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/session") sessionPosts += 1;
    });
    await page.goto("/");

    await submitInitialAccountForm(page, `Malformed ${responseKind}`, requestSentinel);

    await expect(page.getByText("The account connected remotely, but could not be saved in this browser.")).toBeVisible();
    await expect(page.getByLabel("App password")).toHaveValue("");
    expect(sessionPosts).toBe(0);
    await expectSentinelsAbsent(page, [requestSentinel, responseSentinel]);
    expect(consoleMessages.join("\n")).not.toMatch(new RegExp(`${requestSentinel}|${responseSentinel}`));
  });
}

test("account registry wiring keeps corrupt storage when repair deletion fails and still connects safely", async ({ page }) => {
  const corruptValue = "corrupt-registry-secret-sentinel";
  await page.addInitScript((value) => {
    localStorage.setItem("davora-account-state", value);
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function removeItem(key: string) {
      if (key === "davora-account-state") throw new Error("repair-delete-secret-sentinel");
      return original.call(this, key);
    };
  }, corruptValue);

  await page.goto("/");

  await expect(page.getByText("Unable to repair saved account data.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("davora-account-state"))).toBe(corruptValue);
  await submitInitialAccountForm(page, "Repair recovery workspace", "repair-connect-password-sentinel");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expectSentinelsAbsent(page, [corruptValue, "repair-delete-secret-sentinel", "repair-connect-password-sentinel"]);
})

test("account registry wiring keeps remote revoke success visible while browser cleanup remains pending", async ({ page }) => {
  await connectAccount(page, "Removal retry workspace");
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Remove/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Removal retry workspace/i });
  await removeDialog.getByLabel("Account label to confirm").fill("Removal retry workspace");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let removalWrites = 0;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "davora-account-state" && ++removalWrites === 2) {
        throw new Error("removal-write-secret-sentinel");
      }
      return original.call(this, key, value);
    };
  });
  let deleteRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "DELETE" && new URL(request.url()).pathname.startsWith("/api/accounts/")) deleteRequests += 1;
  });

  await removeDialog.getByRole("button", { name: /Remove account/i }).click();

  await expect(removeDialog).toBeVisible();
  await expect(removeDialog.getByText(/remote access was revoked, but browser cleanup is still pending/i)).toBeVisible();
  expect(deleteRequests).toBe(1);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("davora-account-state") ?? "")).toContain('"pendingRemoval":{"phase":"revoke"}');
  await removeDialog.getByRole("button", { name: /Remove account/i }).click();
  await expect(removeDialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  expect(deleteRequests).toBe(2);
})

test("remote revoke failure stays pending across reload, cannot be browsed or selected, and retries to removal", async ({ page }) => {
  await connectAccount(page, "Alpha pending workspace");
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const addDialog = page.getByRole("dialog", { name: /Add account/i });
  await addDialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await addDialog.getByLabel("Username").fill("beta-pending-user");
  await addDialog.getByLabel("App password").fill("beta-pending-password");
  await addDialog.getByLabel("Label").fill("Beta pending survivor workspace");
  await addDialog.getByRole("button", { name: /Add account/i }).click();
  await expect(addDialog).toHaveCount(0);

  await openSettings(page);
  const switchedSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await switchedSettings.getByLabel("Active account").selectOption({ label: "Alpha pending workspace" });
  await switchedSettings.getByRole("button", { name: /Done|Close/i }).click();
  await expect(page.locator(".browse-status-note")).toHaveText(/^(Viewing|Refreshed) \/ in Alpha pending workspace$/);

  let deleteRequests = 0;
  await page.route("**/api/accounts/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deleteRequests += 1;
    if (deleteRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "remote_revoke_failed", message: "Remote revoke unavailable." } })
      });
      return;
    }
    await route.fulfill({ status: 204 });
  });

  await openSettings(page);
  const alphaSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await alphaSettings.getByRole("button", { name: /^Remove$/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Alpha pending workspace/i });
  await removeDialog.getByLabel("Account label to confirm").fill("Alpha pending workspace");
  await removeDialog.getByRole("button", { name: /Remove account/i }).click();
  await expect(removeDialog.getByText(/could not revoke remote access/i)).toBeVisible();
  await expect(page.getByText(/Removed account Alpha pending workspace/i)).toHaveCount(0);
  expect(deleteRequests).toBe(1);

  await removeDialog.getByRole("button", { name: /^Cancel$/i }).click();
  await expect(removeDialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Reconnect Alpha pending workspace/i })).toHaveCount(0);

  await openSettings(page);
  const pendingSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(pendingSettings).toHaveText(/Removal pending for Alpha pending workspace \(remote revoke\)/i);
  await expect(pendingSettings.getByRole("button", { name: /Retry removal/i })).toBeVisible();
  const activeAccountSelect = pendingSettings.getByLabel("Active account");
  await expect(activeAccountSelect.locator("option:checked")).toHaveText("Beta pending survivor workspace");
  await expect(activeAccountSelect.locator("option", { hasText: "Alpha pending workspace" })).toHaveCount(0);
  await pendingSettings.getByRole("button", { name: /Retry removal/i }).click();

  const retryDialog = page.getByRole("dialog", { name: /Remove Alpha pending workspace/i });
  await retryDialog.getByLabel("Account label to confirm").fill("Alpha pending workspace");
  await retryDialog.getByRole("button", { name: /Remove account/i }).click();
  await expect.poll(() => deleteRequests).toBe(2);
  await expect(retryDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await openSettings(page);
  const finalSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(finalSettings.getByLabel("Active account").locator("option:checked")).toHaveText("Beta pending survivor workspace");
  await expect(finalSettings.getByLabel("Active account").locator("option", { hasText: "Alpha pending workspace" })).toHaveCount(0);
  await finalSettings.getByRole("button", { name: /Done|Close/i }).click();
  expect(deleteRequests).toBe(2);
})

test("reload clears a stale reconnect-required browser flag once the worker session can be restored", async ({ page }) => {
  await connectAccount(page, "Reconnect recovery workspace");
  await page.evaluate(() => {
    const raw = localStorage.getItem("davora-account-state");
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as {
      activeAccountId?: string;
      accounts: Array<{ account: Record<string, unknown>; session?: unknown; pendingReconnect?: unknown }>;
    };

    localStorage.setItem("davora-account-state", JSON.stringify({
      activeAccountId: parsed.activeAccountId,
      accounts: parsed.accounts.map((record) => ({
        ...record,
        account: {
          ...record.account,
          connectionState: "reconnect_required"
        },
        session: undefined,
        pendingReconnect: {
          baseUrl: record.account.baseUrl,
          username: record.account.username,
          label: record.account.label
        }
      }))
    }));
  });

  await page.reload();

  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Reconnect/i })).toHaveCount(0);
})

test("adding a second account and switching updates active-account context", async ({ page }) => {
  await connectAccount(page, "Alpha workspace");
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("beta-user");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Beta workspace");
  await dialog.getByRole("button", { name: /Add account/i }).click();
  await expect(dialog).toHaveCount(0);

  await openSettings(page);
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = reopenedSettingsDialog.getByLabel("Active account");
  await expect(activeAccountSelect).toHaveValue(/.+/);
  await activeAccountSelect.selectOption({ label: "Alpha workspace" });
  await expect(activeAccountSelect).toHaveValue(/.+/);
  await activeAccountSelect.selectOption({ label: "Beta workspace" });
  await expect(activeAccountSelect).toHaveValue(/.+/);
})

test("switching accounts clears visible workspace context without removing either account", async ({ page }) => {
  await connectAccount(page, "Alpha context workspace");
  await expect(page.locator(".browse-status-note")).toHaveText("Viewing / in Alpha context workspace");

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const addDialog = page.getByRole("dialog", { name: /Add account/i });
  await addDialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await addDialog.getByLabel("Username").fill("beta-context-user");
  await addDialog.getByLabel("App password").fill("beta-context-password");
  await addDialog.getByLabel("Label").fill("Beta context workspace");
  await addDialog.getByRole("button", { name: /Add account/i }).click();
  await expect(addDialog).toHaveCount(0);
  await expect(page.locator(".browse-status-note")).toHaveText("Viewing / in Beta context workspace");

  await openSettings(page);
  const switchedSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = switchedSettings.getByLabel("Active account");
  await expect(activeAccountSelect.locator("option")).toHaveCount(2);
  await activeAccountSelect.selectOption({ label: "Alpha context workspace" });
  await switchedSettings.getByRole("button", { name: /Done|Close/i }).click();
  await expect(page.locator(".browse-status-note")).toHaveText(/^(Viewing|Refreshed) \/ in Alpha context workspace$/);

  await openSettings(page);
  const retainedSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(retainedSettings.getByLabel("Active account").locator("option")).toHaveText([
    "Alpha context workspace",
    "Beta context workspace"
  ]);
  await retainedSettings.getByRole("button", { name: /Done|Close/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
})

test("worker-side account loss triggers reconnect flow and remove returns to zero state", async ({ page, request, baseURL }) => {
  await connectAccount(page, "Recoverable workspace");
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: /Reconnect Recoverable workspace/i })).toBeVisible();
  await page.getByLabel("App password").fill("renewed-password");
  await page.getByRole("button", { name: /Reconnect account/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Remove/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Recoverable workspace/i });
  await removeDialog.getByLabel("Account label to confirm").fill("Recoverable workspace");
  await removeDialog.getByRole("button", { name: /Remove account/i }).click();
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
})

test("unlock bootstrap prompts after account connect when configured", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          app: "davora",
          configLoaded: true,
          backend: "mock",
          rootPath: ".davora-agent-test",
          unlockRequired: true,
          connectionMode: "in_app",
          supportedAccountTypes: ["nextcloud"]
        }
      })
    });
  });

  let sessionAttempts = 0;
  await page.route("**/api/session", async (route) => {
    sessionAttempts += 1;
    const payload = route.request().postDataJSON() as { unlockCode?: string };
    if (payload.unlockCode !== "open-sesame") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            code: "invalid_unlock_code",
            message: "Unlock code is invalid."
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  await connectAccount(page, "Locked workspace", { waitForWorkspace: false });
  await expect(page.getByRole("heading", { name: /Unlock required/i })).toBeVisible();
  await page.getByLabel("Unlock code").fill("wrong");
  await page.getByRole("button", { name: /Unlock and connect/i }).click();
  await expect(page.getByText(/Ask the deployment operator for the current APP_UNLOCK_CODE/i)).toBeVisible();

  await page.getByLabel("Unlock code").fill("open-sesame");
  await page.getByRole("button", { name: /Unlock and connect/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  expect(sessionAttempts).toBe(2);
})

test("mobile account removal follows scrim and Back dismissal ordering without removing the account", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile account-removal surface ordering characterization.");
  await connectAccount(page, "Mobile removal ordering workspace");

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /^Remove$/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Mobile removal ordering workspace/i });
  await expect(removeDialog).toBeVisible();

  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(removeDialog).toHaveCount(0);

  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /^Remove$/i }).click();
  const removeDialogByBack = page.getByRole("dialog", { name: /Remove Mobile removal ordering workspace/i });
  await expect(removeDialogByBack).toBeVisible();
  await page.goBack();
  await expect(removeDialogByBack).toHaveCount(0);

  await openSettings(page);
  const retainedSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(retainedSettings.getByLabel("Active account")).toHaveValue(/.+/);
  await expect(retainedSettings.getByRole("heading", { name: "Mobile removal ordering workspace" })).toBeVisible();
  await retainedSettings.getByRole("button", { name: /Done|Close/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
});
