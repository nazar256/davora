import { beforeEach, describe, expect, it } from "vitest";

import type { FilePreview } from "@davora/shared";

import {
  cacheOpenedFile,
  clearOpenedFileCache,
  configureOpenedFileCache,
  debugListBlobKeys,
  getCachedOpenedFile,
  listOfflineFileCacheEntries,
  MAX_OPENED_FILE_CACHE_LIMIT,
  MIN_OPENED_FILE_CACHE_LIMIT,
  getOpenedFileCacheSummary,
  listOpenedFileCacheEntries,
  removeOfflineRoot
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

  it("excludes kept-offline entries from normal cache eviction", async () => {
    const thirdLimitBytes = Math.floor(MIN_OPENED_FILE_CACHE_LIMIT / 3) + 1024;
    const largePayload = new Uint8Array(thirdLimitBytes);

    await configureOpenedFileCache(cacheNamespace, MIN_OPENED_FILE_CACHE_LIMIT);
    await cacheOpenedFile(cacheNamespace, {
      path: "offline.txt",
      preview: { ...preview, path: "offline.txt", name: "offline.txt" },
      blob: new Blob([largePayload], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "offline.txt",
      keepOffline: true,
      keepOfflineRoot: "offline.txt",
      keepOfflineRootName: "offline.txt",
      keepOfflineRootKind: "file"
    });
    for (const path of ["temporary-a.txt", "temporary-b.txt", "temporary-c.txt"]) {
      await cacheOpenedFile(cacheNamespace, {
        path,
        preview: { ...preview, path, name: path },
        blob: new Blob([largePayload], { type: "text/plain" }),
        mimeType: "text/plain",
        filename: path
      });
    }

    const entries = await listOpenedFileCacheEntries(cacheNamespace);
    const paths = entries.map((entry) => entry.path).sort();
    expect(paths).toEqual(["offline.txt", "temporary-b.txt", "temporary-c.txt"]);
    expect(entries.find((entry) => entry.path === "offline.txt")?.keepOffline).toBe(true);
  });

  it("preserves kept-offline blob data when later preview caching skips an oversized blob", async () => {
    const largeBlob = new Blob(["offline-text-data"], { type: "text/plain" });

    await cacheOpenedFile(cacheNamespace, {
      path: "Archive/offline.txt",
      preview: { ...preview, path: "Archive/offline.txt", name: "offline.txt" },
      blob: largeBlob,
      mimeType: "text/plain",
      filename: "offline.txt",
      maxBlobBytes: Number.POSITIVE_INFINITY,
      keepOffline: true,
      keepOfflineRoot: "Archive/offline.txt",
      keepOfflineRootName: "offline.txt",
      keepOfflineRootKind: "file"
    });

    await cacheOpenedFile(cacheNamespace, {
      path: "Archive/offline.txt",
      preview: { ...preview, path: "Archive/offline.txt", name: "offline.txt" },
      blob: largeBlob,
      mimeType: "text/plain",
      filename: "offline.txt",
      maxBlobBytes: 1
    });

    const cached = await getCachedOpenedFile(cacheNamespace, "Archive/offline.txt");
    expect(cached?.entry.keepOffline).toBe(true);
    expect(cached?.entry.blobSize).toBe(largeBlob.size);
    expect(cached?.entry.blobKey).toBe(`davora-opened-file:${cacheNamespace}:Archive/offline.txt:blob`);
    expect(await debugListBlobKeys()).toContain(cached?.entry.blobKey);
  });

  it("keeps explicit offline copies when clearing the normal opened-file cache", async () => {
    await cacheOpenedFile(cacheNamespace, {
      path: "offline.txt",
      preview: { ...preview, path: "offline.txt", name: "offline.txt" },
      blob: new Blob(["offline"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "offline.txt",
      keepOffline: true,
      keepOfflineRoot: "offline.txt",
      keepOfflineRootName: "offline.txt",
      keepOfflineRootKind: "file"
    });
    await cacheOpenedFile(cacheNamespace, {
      path: "temporary.txt",
      preview: { ...preview, path: "temporary.txt", name: "temporary.txt" },
      blob: new Blob(["temporary"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "temporary.txt"
    });

    await clearOpenedFileCache(cacheNamespace);

    expect(await getCachedOpenedFile(cacheNamespace, "temporary.txt")).toBeUndefined();
    const cachedOffline = await getCachedOpenedFile(cacheNamespace, "offline.txt");
    expect(cachedOffline?.entry.keepOffline).toBe(true);
    expect(cachedOffline?.blob).toBeDefined();
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

  it("excludes kept-offline entries from the normal cache summary", async () => {
    await cacheOpenedFile(cacheNamespace, {
      path: "offline.txt",
      preview: { ...preview, path: "offline.txt", name: "offline.txt" },
      blob: new Blob(["offline data"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "offline.txt",
      keepOffline: true,
      keepOfflineRoot: "offline.txt",
      keepOfflineRootName: "offline.txt",
      keepOfflineRootKind: "file"
    });
    await cacheOpenedFile(cacheNamespace, {
      path: "temporary.txt",
      preview: { ...preview, path: "temporary.txt", name: "temporary.txt" },
      blob: new Blob(["cache"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "temporary.txt"
    });

    const summary = await getOpenedFileCacheSummary(cacheNamespace);
    expect(summary.itemCount).toBe(1);
    expect(summary.totalBytes).toBe(5);
    expect(await listOfflineFileCacheEntries(cacheNamespace)).toHaveLength(1);
  });

  it("lists and removes a kept-offline root without touching other cached files", async () => {
    await cacheOpenedFile(cacheNamespace, {
      path: "Projects/one.txt",
      preview: { ...preview, path: "Projects/one.txt", name: "one.txt" },
      blob: new Blob(["one"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "one.txt",
      keepOffline: true,
      keepOfflineRoot: "Projects",
      keepOfflineRootName: "Projects",
      keepOfflineRootKind: "folder"
    });
    await cacheOpenedFile(cacheNamespace, {
      path: "Projects/Nested/two.txt",
      preview: { ...preview, path: "Projects/Nested/two.txt", name: "two.txt" },
      blob: new Blob(["two"], { type: "text/plain" }),
      mimeType: "text/plain",
      filename: "two.txt",
      keepOffline: true,
      keepOfflineRoot: "Projects",
      keepOfflineRootName: "Projects",
      keepOfflineRootKind: "folder"
    });
    await cacheOpenedFile(cacheNamespace, {
      path: "Archive/photo.png",
      preview: { ...preview, path: "Archive/photo.png", name: "photo.png" },
      blob: new Blob(["photo"], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    expect(await listOfflineFileCacheEntries(cacheNamespace)).toHaveLength(2);
    await removeOfflineRoot(cacheNamespace, "Projects");

    expect(await listOfflineFileCacheEntries(cacheNamespace)).toHaveLength(0);
    expect(await getCachedOpenedFile(cacheNamespace, "Archive/photo.png")).toBeDefined();
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
