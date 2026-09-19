import { expect, test } from "@playwright/test";

const workerBaseUrl = "http://127.0.0.1:8787";

test("browser cross-origin account removal preflights DELETE and rejects the revoked bearer", async ({ page, request }) => {
  const reset = await request.post(`${workerBaseUrl}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  expect(reset.status()).toBe(204);

  const preflightStatuses: number[] = [];
  const deleteStatuses: number[] = [];
  let oldBearer: string | undefined;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", (event: { type?: string; response: { url: string; status: number } }) => {
    if (event.type !== "Preflight" || !event.response.url.includes("/api/accounts/")) return;
    preflightStatuses.push(event.response.status);
  });
  page.on("request", (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (!url.pathname.startsWith("/api/accounts/")) {
      const authorization = browserRequest.headers().authorization;
      if (!oldBearer && authorization?.startsWith("Bearer ")) oldBearer = authorization.slice("Bearer ".length);
      return;
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/accounts/")) return;
    if (response.request().method() === "DELETE") deleteStatuses.push(response.status());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("cross-origin-user");
  await page.getByLabel("App password").fill("cross-origin-password");
  await page.getByLabel("Label").fill("Cross-origin workspace");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  expect(oldBearer).toBeTruthy();

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await settings.getByRole("button", { name: /^Remove$/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Cross-origin workspace/i });
  await removeDialog.getByLabel("Account label to confirm").fill("Cross-origin workspace");
  await removeDialog.getByRole("button", { name: /Remove account/i }).click();

  await expect.poll(() => preflightStatuses).toEqual([204]);
  await expect.poll(() => deleteStatuses).toEqual([204]);
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();

  const revokedStatus = await page.evaluate(async ({ apiBase, bearer }) => {
    const response = await fetch(`${apiBase}/api/files?path=`, {
      headers: { authorization: `Bearer ${bearer}` }
    });
    return response.status;
  }, { apiBase: workerBaseUrl, bearer: oldBearer });
  expect(revokedStatus).toBeGreaterThanOrEqual(400);
  expect(revokedStatus).toBeLessThan(500);
});
