import { expect, test, type Page } from "@playwright/test";

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("default dev server keeps PWA manifest, service worker control, and Chrome installability available", async ({ page, request, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop Chrome evidence only.");
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as { name: string; display: string; start_url: string; icons: Array<{ src: string }> };
  expect(manifest).toMatchObject({
    name: "Davora",
    display: "standalone",
    start_url: "/"
  });
  expect(manifest.icons.map((icon) => icon.src)).toEqual(expect.arrayContaining(["/pwa-192.png", "/pwa-512.png", "/pwa-512-maskable.png"]));

  const client = await context.newCDPSession(page);
  await client.send("Page.enable");
  const installability = await client.send("Page.getInstallabilityErrors") as { installabilityErrors?: Array<{ errorId?: string }> };
  const blockingErrors = (installability.installabilityErrors ?? []).filter((error) => error.errorId !== "in-incognito");
  expect(blockingErrors).toEqual([]);
});
