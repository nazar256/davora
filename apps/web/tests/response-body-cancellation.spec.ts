import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import { connectAccount, openSettings, openWorkspaceAction } from "./support/workspace";

async function streamingFixture() {
  const events: string[] = [];
  let response: ServerResponse | undefined;
  const server = createServer((request, outgoing) => {
    outgoing.setHeader("access-control-allow-origin", "*");
    outgoing.setHeader("access-control-allow-headers", "authorization");
    if (request.method === "OPTIONS") {
      outgoing.writeHead(204).end();
      return;
    }
    response = outgoing;
    outgoing.writeHead(200, { "content-type": "text/plain", "content-length": "2048" });
    outgoing.flushHeaders();
    outgoing.write("b".repeat(1024));
    events.push("headers-and-first-chunk");
    outgoing.on("close", () => events.push(outgoing.writableFinished ? "completed" : "disconnected-before-end"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/body`,
    events,
    finish: () => response?.end("b".repeat(1024)),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, { headers: { "x-davora-reset-token": "playwright-dev-secret" } });
});

for (const mode of ["cancel", "offline"] as const) {
  test(`post-header ${mode} stops native body and preserves previously retained originals`, async ({ page }, info) => {
    const fixture = await streamingFixture();
    const failedRequests: string[] = [];
    const downloads: string[] = [];
    page.on("requestfailed", (request) => {
      if (request.url() === fixture.url) failedRequests.push(request.failure()?.errorText ?? "unknown");
    });
    try {
      await page.route("**/api/files?path=Projects&listing=complete-v1", (route) => route.fulfill({ json: { data: { path: "Projects", completeness: "complete", items: [
        { path: "Projects/a.txt", name: "a.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "Projects/b.txt", name: "b.txt", isFolder: false, size: 2048, mimeType: "text/plain" }
      ] } } }));
      await page.route("**/api/download?*", async (route) => {
        const path = new URL(route.request().url()).searchParams.get("path")!;
        downloads.push(path);
        if (path === "Projects/a.txt") return route.fulfill({ contentType: "text/plain", body: "a" });
        await route.fulfill({ status: 307, headers: { location: fixture.url } });
      });
      await connectAccount(page, `Native body ${mode}`);
      await page.getByRole("button", { name: "Open actions for Projects", exact: true }).click();
      await page.getByRole("button", { name: "Keep offline", exact: true }).click();
      await page.getByRole("dialog", { name: /Keep offline confirmation/ }).getByRole("button", { name: "Start sync", exact: true }).click();
      const tray = page.getByRole("dialog", { name: "Transfer status" });
      await expect(tray).toBeVisible();
      // This percentage requires the second file's native body chunk, not just response headers.
      await expect(tray.locator(".transfer-tray-item-phase")).toContainText("50%");
      expect(fixture.events).toEqual(["headers-and-first-chunk"]);
      const requestsAfterOffline: string[] = [];
      const stoppedAt = Date.now();
      if (mode === "cancel") {
        await tray.getByRole("button", { name: "Cancel Projects" }).click();
        await expect(tray.locator(".transfer-tray-item-canceled")).toBeVisible();
      } else {
        await tray.getByRole("button", { name: "Close transfer status" }).click();
        page.on("request", (request) => { if (request.url().includes("/api/")) requestsAfterOffline.push(request.url()); });
        await openWorkspaceAction(page, /^Go offline$/);
      }
      await expect.poll(() => fixture.events).toContain("disconnected-before-end");
      await expect.poll(() => failedRequests).toContain("net::ERR_ABORTED");
      const abortLatencyMs = Date.now() - stoppedAt;
      fixture.finish();
      if (mode === "cancel") await tray.getByRole("button", { name: "Close transfer status" }).click();
      await openSettings(page);
      const settings = page.getByRole("dialog", { name: /Profile and settings/ });
      await expect(settings.getByRole("button", { name: "Incomplete", exact: true })).toBeVisible();
      await settings.getByRole("button", { name: "Storage details" }).click();
      await expect(settings.getByText(/Retained originals: 1 B/)).toBeVisible();
      if (mode === "offline") await expect(settings.getByRole("button", { name: "Retry offline copy for Projects" })).toBeDisabled();
      await settings.getByRole("button", { name: /Close|Done/ }).first().click();
      await page.getByRole("button", { name: "Transfers", exact: true }).click();
      await expect(tray.locator(".transfer-tray-item-done")).toHaveCount(0);
      if (mode === "cancel") await expect(tray.locator(".transfer-tray-item-canceled")).toBeVisible();
      else {
        await expect(tray.locator("li.transfer-tray-item-error")).toBeVisible();
        await expect(tray.getByText("Offline sync stopped because its account or connection context changed.")).toBeVisible();
      }
      await expect(tray.locator(".transfer-tray-item-phase")).toContainText("50%");
      const originalBytes = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const opened = indexedDB.open("keyval-store");
          opened.onsuccess = () => resolve(opened.result);
          opened.onerror = () => reject(opened.error);
        });
        try {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const transaction = database.transaction("keyval", "readonly");
            const result = transaction.objectStore("keyval").getAll();
            transaction.oncomplete = () => resolve(result.result);
            transaction.onerror = () => reject(transaction.error);
          });
          return Promise.all(values.filter((value): value is Blob => value instanceof Blob).map((blob) => blob.text()));
        } finally {
          database.close();
        }
      });
      expect(originalBytes).toEqual(["a"]);
      expect(downloads).toEqual(["Projects/a.txt", "Projects/b.txt"]);
      expect(requestsAfterOffline).toEqual([]);
      expect(fixture.events).not.toContain("completed");
      await info.attach("native-body-cancellation", { body: JSON.stringify({ mode, abortLatencyMs, events: fixture.events, failedRequests, downloads, requestsAfterOffline, originalBytes }), contentType: "application/json" });
    } finally {
      await fixture.close();
    }
  });
}
