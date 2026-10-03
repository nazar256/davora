import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileEntry } from "../test/files";
import { createPreviewRequestKey } from "../features/preview/session";
import { createBrowserAppServices } from "./createBrowserAppServices";

describe("browser app services", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 900px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it("injects one browsing-cache authority into folder, search, and composition consumers", () => {
    const services = createBrowserAppServices();
    const folderWrite = vi.spyOn(services.browsingCache, "writeFolder");
    const searchWrite = vi.spyOn(services.browsingCache, "writeSearch");
    const folderItem = buildFileEntry("Docs/a.txt");
    const searchItem = { ...folderItem, score: 1 };

    services.folder.writeCachedFolder("ns", "Docs", [folderItem], "complete");
    services.search.writeCachedSearch("ns", "Docs", "A", [searchItem]);

    expect(folderWrite).toHaveBeenCalledWith("ns", "Docs", [folderItem], "complete");
    expect(searchWrite).toHaveBeenCalledWith("ns", "Docs", "A", [searchItem]);
    expect(services.browsingCache.readFolder("ns", "Docs")).toMatchObject({ completeness: "complete" as const, kind: "hit", items: [folderItem] });
    expect(services.browsingCache.readSearch("ns", "Docs", "a")).toMatchObject({ kind: "hit", items: [searchItem] });
    expect(services.responsiveViewport.getSnapshot()).toEqual({ kind: "wide" });
  });

  it("uses the same retention repository instance for the injected preview runtime", async () => {
    const services = createBrowserAppServices();
    const readPreview = vi.spyOn(services.retentionRepository, "readPreview");
    const adapters = services.previewRuntime.session.createSessionAdapters({ tokenFor: () => "token-alpha" });
    const key = createPreviewRequestKey({
      requestSequence: 1,
      accountId: "alpha",
      cacheNamespace: "cache-alpha",
      path: "Docs/photo.png",
      contextGeneration: "generation-alpha",
      connectionMode: "online",
      heicPreviewEnabled: true,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024
    });

    await adapters.cache.read(key, adapters.abort.create());

    expect(readPreview).toHaveBeenCalledWith({ accountId: "alpha", cacheNamespace: "cache-alpha" }, "Docs/photo.png");
  });
});
