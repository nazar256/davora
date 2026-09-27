import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { connectAccount, openSettings } from "./support/workspace";

declare global {
  interface Window {
    __davoraHeicWorkerCount?: number;
    __davoraHeicDecodeCount?: number;
    __davoraPreviewStartedAt?: number;
  }
}

async function navigateToTimedPreview(page: Page, currentFilename: string, nextFilename: string): Promise<number> {
  await page.evaluate(() => { window.__davoraPreviewStartedAt = performance.now(); });
  await page.getByRole("dialog", { name: new RegExp(`Preview ${currentFilename}`, "i") })
    .getByRole("button", { name: /Next media item/i }).click();
  const preview = page.getByRole("dialog", { name: new RegExp(`Preview ${nextFilename}`, "i") });
  await expect(preview.locator("img.media-preview-image")).toBeVisible();
  const elapsed = await page.evaluate(() => performance.now() - (window.__davoraPreviewStartedAt ?? performance.now()));
  return elapsed;
}

async function countStoredPreviewDerivatives(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error ?? new Error("Unable to open preview storage."));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction("keyval", "readonly");
        const request = transaction.objectStore("keyval").getAllKeys();
        request.onerror = () => reject(request.error ?? new Error("Unable to inspect preview storage."));
        request.onsuccess = () => resolve(request.result.filter(
          (key) => typeof key === "string" && key.startsWith("davora-opened-file:v2:derived:")
        ).length);
      });
    } finally {
      database.close();
    }
  });
}

test("retained HEIC look-ahead pre-renders the configured next three images for offline opens", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "One controlled Chromium performance pass is sufficient.");
  const heic = await readFile(new URL("./fixtures/images/libheif-example.heic", import.meta.url));
  const filenames = ["photo-a.heic", "photo-b.heic", "photo-c.heic", "photo-d.heic"];
  let fileRequests = 0;

  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const heicWorkers = new WeakSet<Worker>();
    window.__davoraHeicWorkerCount = 0;
    window.__davoraHeicDecodeCount = 0;
    window.Worker = class extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        if (String(scriptURL).includes("heicPreviewWorker")) {
          heicWorkers.add(this);
          window.__davoraHeicWorkerCount = (window.__davoraHeicWorkerCount ?? 0) + 1;
        }
      }

      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]): void {
        if (heicWorkers.has(this)) window.__davoraHeicDecodeCount = (window.__davoraHeicDecodeCount ?? 0) + 1;
        if (options === undefined) {
          super.postMessage(message);
        } else if (Array.isArray(options)) {
          super.postMessage(message, options);
        } else {
          super.postMessage(message, options);
        }
      }
    };
  });
  await page.route("**/api/files?path=Archive", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Archive",
          items: filenames.map((name) => ({ path: `Archive/${name}`, name, isFolder: false, size: heic.length, mimeType: "image/heic" }))
        }
      })
    });
  });
  await page.route("**/api/file?path=Archive%2Fphoto-*.heic", async (route) => {
    fileRequests += 1;
    const path = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "");
    const name = path.split("/").at(-1) ?? filenames[0]!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { file: { path, name, isFolder: false, size: heic.length, mimeType: "image/heic", viewer: "image", content: "", encoding: "none", truncated: false, bytesRead: 0, requiresOriginalBlob: true } } })
    });
  });
  for (const pattern of ["**/api/download?path=Archive%2Fphoto-*.heic", "**/api/file/original?path=Archive%2Fphoto-*.heic"]) {
    await page.route(pattern, async (route) => {
      fileRequests += 1;
      const path = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "");
      const name = path.split("/").at(-1) ?? filenames[0]!;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/heic", "content-disposition": `attachment; filename*=UTF-8''${name}` },
        body: heic
      });
    });
  }

  await connectAccount(page, "HEIC sidecar workspace");
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await settings.getByLabel(/Enable experimental HEIC preview/i).check();
  await settings.getByLabel(/Images to preload ahead/i).selectOption("3");
  await settings.getByRole("button", { name: /Close|Done/i }).click();
  await page.getByRole("button", { name: /Open actions for Archive/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  const transfer = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transfer.getByText(/^Done/)).toBeVisible();
  await transfer.getByRole("button", { name: /Close/i }).click();
  const closeActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeActions.isVisible().catch(() => false)) await closeActions.click();
  await page.getByRole("button", { name: /Open folder Archive/i }).click();

  await page.getByRole("button", { name: /Open file photo-a.heic/i }).click();
  const firstPreview = page.getByRole("dialog", { name: /Preview photo-a.heic/i });
  // Cold WASM HEIC decode of a real fixture takes seconds on a busy host;
  // the serialized look-ahead decodes then fill the remaining three slots.
  await expect(firstPreview.locator("img.media-preview-image")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__davoraHeicDecodeCount), { timeout: 30_000 }).toBe(4);
  await expect.poll(() => countStoredPreviewDerivatives(page), { timeout: 30_000 }).toBe(4);
  expect(await page.evaluate(() => window.__davoraHeicWorkerCount)).toBe(1);
  await firstPreview.getByRole("button", { name: /Back to files/i }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: /Open file photo-a.heic/i })).toBeVisible();
  expect(await page.evaluate(() => window.__davoraHeicWorkerCount)).toBe(0);
  expect(await page.evaluate(() => window.__davoraHeicDecodeCount)).toBe(0);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const requestsBeforeCachedOpens = fileRequests;

  await page.getByRole("button", { name: /Open file photo-a.heic/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview photo-a.heic/i }).locator("img.media-preview-image")).toBeVisible();
  const timings: number[] = [];
  for (let index = 1; index < filenames.length; index += 1) {
    timings.push(await navigateToTimedPreview(page, filenames[index - 1]!, filenames[index]!));
  }
  await page.getByRole("dialog", { name: /Preview photo-d.heic/i }).getByRole("button", { name: /Back to files/i }).click();
  timings.sort((left, right) => left - right);
  const median = timings[Math.floor(timings.length / 2)] ?? Number.POSITIVE_INFINITY;
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
  testInfo.annotations.push({
    type: "performance",
    description: JSON.stringify({ fixtureBytes: heic.length, medianMs: median, p95Ms: p95, timingsMs: timings })
  });

  expect(await page.evaluate(() => window.__davoraHeicWorkerCount)).toBe(0);
  expect(await page.evaluate(() => window.__davoraHeicDecodeCount)).toBe(0);
  expect(fileRequests).toBe(requestsBeforeCachedOpens);
  // The decisive evidence is zero decodes/requests above; the timing bound is a
  // smoke guard against re-introducing cold-decode-scale work (seconds, not
  // milliseconds). Shared-host render+polling jitter pushes a genuinely cached
  // 1280x854 JPEG open into the few-hundred-ms range, so the ceiling stays an
  // order of magnitude below a real decode rather than chasing a fixed budget.
  expect(p95, `cached HEIC open timings: ${timings.map((value) => value.toFixed(1)).join(", ")} ms`).toBeLessThanOrEqual(1500);
});
