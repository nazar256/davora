import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { connectAccount, openSettings } from "./support/workspace";

declare global {
  interface Window {
    __davoraHeicWorkerCount?: number;
    __davoraHeicDecodeCount?: number;
    __davoraPreviewStartedAt?: number;
    __davoraStopContention?: boolean;
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
  await page.route("**/api/files?path=Archive&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
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

/** Browser-valid JPEG: noisy source compresses poorly, then zero-padding beyond EOI reaches the target size. */
async function generateJpegBytes(page: Page, targetBytes: number): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = (index * 2654435761) % 251;
      image.data[index + 1] = (index * 40503) % 241;
      image.data[index + 2] = (index * 97) % 229;
      image.data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? "";
  });
  const bytes = Buffer.from(base64, "base64");
  return bytes.length >= targetBytes ? bytes : Buffer.concat([bytes, Buffer.alloc(targetBytes - bytes.length)]);
}

test("ordinary image cache reopens a >4MB working set with zero network and no decode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "One controlled Chromium performance pass is sufficient.");
  const heic = await readFile(new URL("./fixtures/images/libheif-example.heic", import.meta.url));
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
  await connectAccount(page, "Ordinary cache workspace");
  const jpeg = await generateJpegBytes(page, 1024 * 1024);
  const files = [
    { name: "photo-a.jpg", mime: "image/jpeg", body: jpeg },
    { name: "photo-b.jpg", mime: "image/jpeg", body: jpeg },
    { name: "photo-c.heic", mime: "image/heic", body: heic },
    { name: "photo-d.heic", mime: "image/heic", body: jpeg },
    { name: "photo-e.jpg", mime: "image/jpeg", body: jpeg },
    { name: "photo-f.jpg", mime: "image/jpeg", body: jpeg }
  ];

  await page.route("**/api/files?path=Archive&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Archive",
          items: files.map((entry) => ({ path: `Archive/${entry.name}`, name: entry.name, isFolder: false, size: entry.body.length, mimeType: entry.mime }))
        }
      })
    });
  });
  await page.route("**/api/file?path=Archive%2F*", async (route) => {
    fileRequests += 1;
    const name = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "").split("/").pop() ?? "";
    const entry = files.find((item) => item.name === name);
    if (!entry) return route.fulfill({ status: 404 });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { file: { path: `Archive/${entry.name}`, name: entry.name, isFolder: false, size: entry.body.length, mimeType: entry.mime, viewer: "image", content: "", encoding: "none", truncated: false, bytesRead: 0, requiresOriginalBlob: true } } })
    });
  });
  await page.route("**/api/file/original?path=Archive%2F*", async (route) => {
    fileRequests += 1;
    const name = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "").split("/").pop() ?? "";
    const entry = files.find((item) => item.name === name) ?? files[0]!;
    await route.fulfill({
      status: 200,
      headers: { "content-type": entry.mime, "content-disposition": `attachment; filename*=UTF-8''${entry.name}` },
      body: entry.body
    });
  });

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await settings.getByLabel(/Enable experimental HEIC preview/i).check();
  await settings.getByLabel(/Images to preload ahead/i).selectOption("1");
  // A long freshness window keeps this spec on the deterministic cache-hit path;
  // stale-entry refresh behavior is covered by the retained suite above.
  await settings.getByLabel(/Cached preview update check interval unit/i).selectOption("weeks");
  await settings.getByLabel(/Cached preview update check interval value/i).fill("1");
  await settings.getByLabel(/Cached preview update check interval value/i).press("Enter");
  await settings.getByRole("button", { name: /Close|Done/i }).click();
  await page.getByRole("button", { name: /Open folder Archive/i }).click();

  // First pass fills the ordinary cache with ~5MB of material — larger than the
  // former 4MB shipped default that evicted records faster than users reopened.
  const firstOpenTimings: Record<string, number> = {};
  for (const entry of files) {
    await page.evaluate(() => { window.__davoraPreviewStartedAt = performance.now(); });
    await page.getByRole("button", { name: new RegExp(`Open file ${entry.name.replace(".", "\\.")}`, "i") }).click();
    const preview = page.getByRole("dialog", { name: new RegExp(`Preview ${entry.name.replace(".", "\\.")}`, "i") });
    await expect(preview.locator("img.media-preview-image")).toBeVisible({ timeout: 30_000 });
    firstOpenTimings[entry.name] = await page.evaluate(() => performance.now() - (window.__davoraPreviewStartedAt ?? performance.now()));
    await preview.getByRole("button", { name: /Back to files/i }).click();
    await expect(preview).toHaveCount(0);
  }

  // Let the trailing look-ahead prefetch settle before measuring cache reads.
  await expect.poll(async () => fileRequests, { timeout: 15_000 }).toBeGreaterThanOrEqual(files.length * 2);
  await page.waitForTimeout(1_500);
  const requestsBeforeReopen = fileRequests;

  // Reload simulates an app restart: persisted IndexedDB records must still hit.
  // Note addInitScript resets the in-page counters, so their baseline is read post-reload.
  await page.reload();
  const decodesBeforeReopen = await page.evaluate(() => window.__davoraHeicDecodeCount ?? 0);
  const workersBeforeReopen = await page.evaluate(() => window.__davoraHeicWorkerCount ?? 0);
  const archiveFolder = page.getByRole("button", { name: /Open folder Archive/i });
  if (await archiveFolder.isVisible().catch(() => false)) {
    await archiveFolder.click();
  }
  await expect(page.getByRole("button", { name: /Open file photo-a.jpg/i })).toBeVisible();

  const reopenTimings: Record<string, number> = {};
  for (const entry of files) {
    await page.evaluate(() => { window.__davoraPreviewStartedAt = performance.now(); });
    await page.getByRole("button", { name: new RegExp(`Open file ${entry.name.replace(".", "\\.")}`, "i") }).click();
    const preview = page.getByRole("dialog", { name: new RegExp(`Preview ${entry.name.replace(".", "\\.")}`, "i") });
    await expect(preview.locator("img.media-preview-image")).toBeVisible({ timeout: 15_000 });
    reopenTimings[entry.name] = await page.evaluate(() => performance.now() - (window.__davoraPreviewStartedAt ?? performance.now()));
    await preview.getByRole("button", { name: /Back to files/i }).click();
    await expect(preview).toHaveCount(0);
  }

  const sortedReopens = Object.values(reopenTimings).sort((left, right) => left - right);
  const reopenP95 = sortedReopens[Math.ceil(sortedReopens.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
  testInfo.annotations.push({
    type: "performance",
    description: JSON.stringify({ workingSetBytes: files.reduce((sum, entry) => sum + entry.body.length, 0), firstOpenMs: firstOpenTimings, reopenMs: reopenTimings, reopenP95Ms: reopenP95 })
  });

  // Zero re-fetches, zero re-decodes, zero new workers across every reopen —
  // the eviction ping-pong this regression covered made all three non-zero.
  expect(fileRequests, "cached reopens must not refetch file metadata or originals").toBe(requestsBeforeReopen);
  expect(await page.evaluate(() => window.__davoraHeicDecodeCount)).toBe(decodesBeforeReopen);
  expect(await page.evaluate(() => window.__davoraHeicWorkerCount)).toBe(workersBeforeReopen);
  expect(reopenP95, `cached reopen timings: ${sortedReopens.map((value) => value.toFixed(1)).join(", ")} ms`).toBeLessThanOrEqual(2000);
});

// Writes `bytes` of ~4MB records into the shared keyval store, one transaction
// each (matching kept-offline material shape). A put that stalls longer than
// `stallMs` reports as stalled rather than hanging — Chromium can wedge IDB
// write transactions without ever firing complete/error under write pressure.
async function seedBulkRecords(page: Page, bytes: number, stallMs = 30_000): Promise<{ puts: number; stalled: boolean }> {
  return page.evaluate(async ({ bytes: target, stallMs: stall }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error ?? new Error("Unable to open preview storage."));
      request.onsuccess = () => resolve(request.result);
    });
    const seed = new Uint8Array(4 * 1024 * 1024);
    for (let index = 0; index < seed.length; index += 4096) {
      seed[index] = index % 251;
    }
    const blob = new Blob([seed], { type: "application/octet-stream" });
    const put = (key: string) => new Promise<boolean>((resolve) => {
      const transaction = database.transaction("keyval", "readwrite");
      transaction.objectStore("keyval").put(blob, key);
      const timer = setTimeout(() => resolve(false), stall);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(true); };
      transaction.onerror = () => { clearTimeout(timer); resolve(false); };
    });
    try {
      let written = 0;
      let puts = 0;
      let stalled = false;
      while (written < target && !stalled) {
        if (!(await put(`bulk-seed:${puts}`))) {
          stalled = true;
          break;
        }
        puts += 1;
        written += blob.size;
      }
      return { puts, stalled };
    } finally {
      database.close();
    }
  }, { bytes, stallMs });
}

// Continuous 8MB puts until `durationMs` elapses, `__davoraStopContention` is
// set, or a write stalls — models kept-offline sync churning the shared store
// while the user keeps interacting.
async function runContentionWriter(page: Page, durationMs: number, stallMs = 30_000): Promise<{ count: number; stalled: boolean }> {
  return page.evaluate(async ({ durationMs: duration, stallMs: stall }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error ?? new Error("Unable to open preview storage."));
      request.onsuccess = () => resolve(request.result);
    });
    const blob = new Blob([new Uint8Array(8 * 1024 * 1024)]);
    let count = 0;
    const write = () => new Promise<boolean>((resolve) => {
      const transaction = database.transaction("keyval", "readwrite");
      transaction.objectStore("keyval").put(blob, `contention:${count++}`);
      const timer = setTimeout(() => resolve(false), stall);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(true); };
      transaction.onerror = () => { clearTimeout(timer); resolve(false); };
    });
    const stop = Date.now() + duration;
    let stalled = false;
    while (Date.now() < stop && !window.__davoraStopContention) {
      if (!(await write())) {
        stalled = true;
        break;
      }
    }
    return { count, stalled };
  }, { durationMs, stallMs });
}

test("cache reads stay bounded under IndexedDB volume and concurrent write pressure", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "One controlled Chromium performance pass is sufficient.");
  let fileRequests = 0;

  await connectAccount(page, "Contention workspace");
  const jpeg = await generateJpegBytes(page, 1024 * 1024);
  const files = [
    { name: "photo-a.jpg", mime: "image/jpeg", body: jpeg },
    { name: "photo-b.jpg", mime: "image/jpeg", body: jpeg },
    { name: "photo-c.jpg", mime: "image/jpeg", body: jpeg }
  ];

  await page.route("**/api/files?path=Archive&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Archive",
          items: files.map((entry) => ({ path: `Archive/${entry.name}`, name: entry.name, isFolder: false, size: entry.body.length, mimeType: entry.mime }))
        }
      })
    });
  });
  await page.route("**/api/file?path=Archive%2F*", async (route) => {
    fileRequests += 1;
    const name = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "").split("/").pop() ?? "";
    const entry = files.find((item) => item.name === name);
    if (!entry) return route.fulfill({ status: 404 });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { file: { path: `Archive/${entry.name}`, name: entry.name, isFolder: false, size: entry.body.length, mimeType: entry.mime, viewer: "image", content: "", encoding: "none", truncated: false, bytesRead: 0, requiresOriginalBlob: true } } })
    });
  });
  await page.route("**/api/file/original?path=Archive%2F*", async (route) => {
    fileRequests += 1;
    const name = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "").split("/").pop() ?? "";
    const entry = files.find((item) => item.name === name) ?? files[0]!;
    await route.fulfill({
      status: 200,
      headers: { "content-type": entry.mime, "content-disposition": `attachment; filename*=UTF-8''${entry.name}` },
      body: entry.body
    });
  });

  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  for (const entry of files) {
    await page.getByRole("button", { name: new RegExp(`Open file ${entry.name.replace(".", "\\.")}`, "i") }).click();
    const preview = page.getByRole("dialog", { name: new RegExp(`Preview ${entry.name.replace(".", "\\.")}`, "i") });
    await expect(preview.locator("img.media-preview-image")).toBeVisible({ timeout: 30_000 });
    await preview.getByRole("button", { name: /Back to files/i }).click();
    await expect(preview).toHaveCount(0);
  }

  // 256MB of bulk records sits well below the observed Chromium write-stall
  // cliff (~1.1GB under sustained bursts) while exceeding any realistic
  // browsing working set — volume alone must not slow point reads.
  const seeded = await seedBulkRecords(page, 256 * 1024 * 1024);
  expect(seeded.stalled, `bulk seed stalled after ${seeded.puts} puts`).toBe(false);

  const reopenTimed = async (filename: string): Promise<number> => {
    await page.evaluate(() => { window.__davoraPreviewStartedAt = performance.now(); });
    await page.getByRole("button", { name: new RegExp(`Open file ${filename.replace(".", "\\.")}`, "i") }).click();
    const preview = page.getByRole("dialog", { name: new RegExp(`Preview ${filename.replace(".", "\\.")}`, "i") });
    await expect(preview.locator("img.media-preview-image")).toBeVisible({ timeout: 30_000 });
    const elapsed = await page.evaluate(() => performance.now() - (window.__davoraPreviewStartedAt ?? performance.now()));
    await preview.getByRole("button", { name: /Back to files/i }).click();
    await expect(preview).toHaveCount(0);
    return elapsed;
  };

  const idleTimings: Record<string, number> = {};
  for (const entry of files) {
    idleTimings[entry.name] = await reopenTimed(entry.name);
  }

  // Now reopen while a background writer churns the shared store — this is the
  // production failure shape: reads embedded writes (unconditional index
  // persist + lastAccessedAt) that inherited write-transaction stalls and
  // surfaced as 6-25s "cache.read" timings. A read-only read path must stay
  // interactive while writes queue behind it.
  const requestsBeforeContention = fileRequests;
  const writer = runContentionWriter(page, 20_000);
  await page.waitForTimeout(300);
  const contentionTimings: Record<string, number> = {};
  for (const entry of files) {
    contentionTimings[entry.name] = await reopenTimed(entry.name);
  }
  await page.evaluate(() => { window.__davoraStopContention = true; });
  const writerResult = await writer;

  testInfo.annotations.push({
    type: "performance",
    description: JSON.stringify({ seededBytes: seeded.puts * 4 * 1024 * 1024, contentionWrites: writerResult.count, writerStalled: writerResult.stalled, idleMs: idleTimings, contentionMs: contentionTimings })
  });

  expect(fileRequests, "cached reopens under write pressure must not refetch").toBe(requestsBeforeContention);
  for (const entry of files) {
    // Production regression shape was 6.3-24.8s reads; 5s keeps the bound an
    // order of magnitude below the failure while tolerating shared-host jitter.
    expect(
      contentionTimings[entry.name]!,
      `reopen of ${entry.name} under write contention`
    ).toBeLessThanOrEqual(5000);
  }
});
