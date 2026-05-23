import { beforeEach, describe, expect, it } from "vitest";

import type { FilePreview } from "@davora/shared";

import {
  cacheOpenedFile,
  clearOpenedFileCache,
  configureOpenedFileCache,
  debugListBlobKeys,
  getCachedOpenedFile,
  MAX_OPENED_FILE_CACHE_LIMIT,
  MIN_OPENED_FILE_CACHE_LIMIT,
  getOpenedFileCacheSummary,
  listOpenedFileCacheEntries
} from "./lib/openedFileCache";

const cacheNamespace = "account-alpha";
const preview: FilePreview = {
  path: "Projects/roadmap.txt",
  name: "roadmap.txt",
  isFolder: false,
  mimeType: "text/plain",
  viewer: "text",
  content: "hello",
  encoding: "utf8",
  truncated: false,
  bytesRead: 5
};

beforeEach(async () => {
  await clearOpenedFileCache();
  await configureOpenedFileCache(cacheNamespace, 1024 * 1024);
});

describe("opened-file cache", () => {
  it("stores preview metadata and blob payload separately by account namespace", async () => {
    await cacheOpenedFile(cacheNamespace, {
      path: preview.path,
      preview,
      blob: new Blob(["hello"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "roadmap.txt"
    });

    const cached = await getCachedOpenedFile(cacheNamespace, preview.path);
    expect(cached?.entry.preview.content).toBe("hello");
    expect(cached?.entry.blobSize).toBe(5);
    expect(cached).toHaveProperty("blob");
    expect(await debugListBlobKeys()).toContain(`davora-opened-file:${cacheNamespace}:${preview.path}:blob`);
  });

  it("evicts least-recently-used blobs when over configured limit", async () => {
    const halfLimitBytes = Math.floor(MIN_OPENED_FILE_CACHE_LIMIT / 2) + 1024;
    const largePayload = new Uint8Array(halfLimitBytes);

    await configureOpenedFileCache(cacheNamespace, MIN_OPENED_FILE_CACHE_LIMIT);
    await cacheOpenedFile(cacheNamespace, {
      path: "one.txt",
      preview: { ...preview, path: "one.txt", name: "one.txt" },
      blob: new Blob([largePayload], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "one.txt"
    });
    await cacheOpenedFile(cacheNamespace, {
      path: "two.txt",
      preview: { ...preview, path: "two.txt", name: "two.txt" },
      blob: new Blob([largePayload], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "two.txt"
    });

    const entries = await listOpenedFileCacheEntries(cacheNamespace);
    expect(entries.map((entry) => entry.path)).toEqual(["two.txt"]);
  });

  it("reports cache summary for one account namespace", async () => {
    await cacheOpenedFile(cacheNamespace, {
      path: preview.path,
      preview,
      blob: new Blob(["hello"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "roadmap.txt"
    });

    const summary = await getOpenedFileCacheSummary(cacheNamespace);
    expect(summary.itemCount).toBe(1);
    expect(summary.totalBytes).toBeGreaterThan(0);
  });

  it("keeps preview metadata while skipping blob storage above the configured cacheable file-size ceiling", async () => {
    const oversizedBlob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "application/octet-stream" });

    await cacheOpenedFile(cacheNamespace, {
      path: "Archive/big.bin",
      preview: { ...preview, path: "Archive/big.bin", name: "big.bin", viewer: "audio", mimeType: "audio/mpeg", content: "", encoding: "none" },
      blob: oversizedBlob,
      mimeType: "audio/mpeg",
      filename: "big.bin",
      maxBlobBytes: 1024 * 1024
    });

    const cached = await getCachedOpenedFile(cacheNamespace, "Archive/big.bin");
    expect(cached?.entry.blobSize).toBe(0);
    expect(cached?.blob).toBeUndefined();
  });

  it("clamps configured cache limit to supported UI range", async () => {
    await configureOpenedFileCache(cacheNamespace, 1);
    expect((await getOpenedFileCacheSummary(cacheNamespace)).limitBytes).toBe(MIN_OPENED_FILE_CACHE_LIMIT);

    await configureOpenedFileCache(cacheNamespace, MAX_OPENED_FILE_CACHE_LIMIT * 2);
    expect((await getOpenedFileCacheSummary(cacheNamespace)).limitBytes).toBe(MAX_OPENED_FILE_CACHE_LIMIT);
  });
});
