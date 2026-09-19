import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../../../lib/api";

import { buildFolderInlineBanner, classifyListState } from "./listBanner";

describe("classifyListState", () => {
  it.each([
    [true, "Showing cached data while offline."],
    [false, "Showing cached data while the local server is unavailable."]
  ] as const)("uses cache-only stale copy when offline=%s", (offline, message) => {
    expect(classifyListState({
      cacheOnlyMode: true,
      stale: true,
      refreshing: false,
      offline
    })).toEqual({ kind: "stale", message });
  });

  it("uses background refresh copy when refreshing and stale", () => {
    expect(classifyListState({
      cacheOnlyMode: false,
      stale: true,
      refreshing: true,
      offline: false
    })).toEqual({
      kind: "stale",
      message: "Showing cached data while checking for changes in the background."
    });
  });

  it("uses plain stale copy when stale without cache-only or refreshing", () => {
    expect(classifyListState({
      cacheOnlyMode: false,
      stale: true,
      refreshing: false,
      offline: false
    })).toEqual({
      kind: "stale",
      message: "Showing cached data because live refresh did not replace it."
    });
  });

  it.each([
    [true, "Offline mode: cached reads are available, mutations stay disabled until you reconnect."],
    [false, "Local server unavailable: cached reads are available, mutations stay disabled until Davora can reach the server again."]
  ] as const)("uses cache-only mutation-disabled copy when offline=%s", (offline, message) => {
    expect(classifyListState({
      cacheOnlyMode: true,
      stale: false,
      refreshing: false,
      offline
    })).toEqual({ kind: "offline", message });
  });

  it.each([
    [401, undefined, "permission"],
    [403, undefined, "permission"],
    [404, "permission_denied", "permission"]
  ] as const)("classifies permission errors for status=%s code=%s", (status, code, kind) => {
    const error = new ApiRequestError("Access denied", status, code);
    expect(classifyListState({
      error,
      cacheOnlyMode: false,
      stale: false,
      refreshing: false,
      offline: false
    })).toEqual({ kind, message: "Access denied" });
  });

  it("classifies generic errors", () => {
    expect(classifyListState({
      error: new Error("load failed"),
      cacheOnlyMode: false,
      stale: false,
      refreshing: false,
      offline: false
    })).toEqual({ kind: "error", message: "load failed" });
  });

  it("returns idle when no error and not cache-only or stale", () => {
    expect(classifyListState({
      cacheOnlyMode: false,
      stale: false,
      refreshing: false,
      offline: false
    })).toEqual({ kind: "idle", message: "" });
  });
});

describe("buildFolderInlineBanner", () => {
  const classified = { kind: "error" as const, message: "load failed" };

  it("prefers explicit offline mode", () => {
    expect(buildFolderInlineBanner({
      explicitOfflineMode: true,
      loadingFolder: true,
      folderBanner: classified,
      refreshingFolder: false,
      staleFolder: false,
      cacheOnlyMode: false,
      visibleListError: new Error("operation failed")
    })).toEqual({
      banner: {
        kind: "offline",
        message: "Explicit offline mode is active. Only files stored on this device are shown."
      },
      showRoutineCachedRefresh: false
    });
  });

  it("prefers loading over classified banner", () => {
    expect(buildFolderInlineBanner({
      explicitOfflineMode: false,
      loadingFolder: true,
      folderBanner: classified,
      refreshingFolder: false,
      staleFolder: false,
      cacheOnlyMode: false,
      visibleListError: new Error("operation failed")
    })).toEqual({
      banner: { kind: "loading", message: "Loading folder..." },
      showRoutineCachedRefresh: false
    });
  });

  it("suppresses routine cached-refresh stale banner", () => {
    expect(buildFolderInlineBanner({
      explicitOfflineMode: false,
      loadingFolder: false,
      folderBanner: {
        kind: "stale",
        message: "Showing cached data while checking for changes in the background."
      },
      refreshingFolder: true,
      staleFolder: true,
      cacheOnlyMode: false
    })).toEqual({
      banner: { kind: "idle", message: "" },
      showRoutineCachedRefresh: true
    });
  });

  it("does not suppress stale banner when cache-only or list error is present", () => {
    const staleBanner = {
      kind: "stale" as const,
      message: "Showing cached data while checking for changes in the background."
    };

    expect(buildFolderInlineBanner({
      explicitOfflineMode: false,
      loadingFolder: false,
      folderBanner: staleBanner,
      refreshingFolder: true,
      staleFolder: true,
      cacheOnlyMode: true
    })).toEqual({
      banner: staleBanner,
      showRoutineCachedRefresh: false
    });

    expect(buildFolderInlineBanner({
      explicitOfflineMode: false,
      loadingFolder: false,
      folderBanner: staleBanner,
      refreshingFolder: true,
      staleFolder: true,
      cacheOnlyMode: false,
      visibleListError: new Error("load failed")
    })).toEqual({
      banner: staleBanner,
      showRoutineCachedRefresh: false
    });
  });

  it("returns classified banner otherwise", () => {
    expect(buildFolderInlineBanner({
      explicitOfflineMode: false,
      loadingFolder: false,
      folderBanner: classified,
      refreshingFolder: false,
      staleFolder: false,
      cacheOnlyMode: false
    })).toEqual({
      banner: classified,
      showRoutineCachedRefresh: false
    });
  });
});
