import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { applyFolderStatus, type FolderStatusContext, type FolderStatusPorts } from "./folderStatus";
import type { FolderKey, FolderState } from "./model";

const key: FolderKey = { accountId: "alpha", cacheNamespace: "ns-alpha", path: "Docs/Reports" };
const contextToken = {};
const items: FileEntry[] = [{ path: "Docs/Reports/a.txt", name: "a.txt", isFolder: false }];
const error = new Error("load failed");

const context = (overrides: Partial<FolderStatusContext> = {}): FolderStatusContext => ({
  path: "Docs/Reports",
  accountName: "Work",
  token: "token-alpha",
  ...overrides
});

const createPorts = (): FolderStatusPorts & {
  setStatus: ReturnType<typeof vi.fn>;
  clearListError: ReturnType<typeof vi.fn>;
} => {
  const setStatus = vi.fn<(message: string) => void>();
  const clearListError = vi.fn<() => void>();
  return { setStatus, clearListError };
};

describe("applyFolderStatus", () => {
  it("does not mutate chrome for idle", () => {
    const ports = createPorts();
    applyFolderStatus({ kind: "idle" }, context(), ports);
    expect(ports.setStatus).not.toHaveBeenCalled();
    expect(ports.clearListError).not.toHaveBeenCalled();
  });

  it("clears listError for initialLoading without setting status", () => {
    const ports = createPorts();
    applyFolderStatus({ kind: "initialLoading", request: { key, generation: 1, contextToken } }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).not.toHaveBeenCalled();
  });

  it("clears listError and announces cached-while-checking for refreshing", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "refreshing",
      request: { key, generation: 1, contextToken },
      items,
      source: "cache"
    }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).toHaveBeenCalledWith(
      "Showing cached folder for /Docs/Reports in Work while checking for changes."
    );
  });

  it.each([
    ["viewing", "Viewing /Docs/Reports in Work"],
    ["refreshed", "Refreshed /Docs/Reports in Work"]
  ] as const)("clears listError and sets ready status for %s", (message, expectedStatus) => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "ready",
      key,
      contextToken,
      items,
      source: "live",
      message
    }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).toHaveBeenCalledWith(expectedStatus);
  });

  it("clears listError but skips status when ready message is silent", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "ready",
      key,
      contextToken,
      items,
      source: "live",
      message: "silent"
    }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["offline", "Offline snapshot for /Docs/Reports in Work"],
    ["server-unavailable", "Cached snapshot for /Docs/Reports in Work while the local server is unavailable."],
    ["refresh-failed", "Still showing cached folder for /Docs/Reports in Work because live refresh failed."]
  ] as const)("clears listError and sets stale status for %s", (reason, expectedStatus) => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "stale",
      key,
      contextToken,
      items,
      source: "cache",
      reason
    }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).toHaveBeenCalledWith(expectedStatus);
  });

  it("skips stale status at root without a token", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "stale",
      key: { ...key, path: "" },
      contextToken,
      items: [],
      source: "cache",
      reason: "offline"
    }, context({ path: "", token: undefined }), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).not.toHaveBeenCalled();
  });

  it("sets offline files status and clears listError", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "offline",
      key,
      contextToken,
      items,
      source: "explicit-offline"
    }, context(), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).toHaveBeenCalledWith("Offline files in /Docs/Reports for Work.");
  });

  it("skips offline status at root without a token", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "offline",
      key: { ...key, path: "" },
      contextToken,
      items: [],
      source: "explicit-offline"
    }, context({ path: "", token: undefined }), ports);
    expect(ports.clearListError).toHaveBeenCalledOnce();
    expect(ports.setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["offline-cache-miss", "Offline and no cached folder is available for /Docs/Reports in Work"],
    ["server-cache-miss", "Local server unavailable and no cached folder is available for /Docs/Reports in Work"]
  ] as const)("sets failed status for %s", (reason, expectedStatus) => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "failed",
      key,
      contextToken,
      error,
      reason
    }, context(), ports);
    expect(ports.setStatus).toHaveBeenCalledWith(expectedStatus);
    expect(ports.clearListError).not.toHaveBeenCalled();
  });

  it("does not set status for live-failure", () => {
    const ports = createPorts();
    applyFolderStatus({
      kind: "failed",
      key,
      contextToken,
      error,
      reason: "live-failure"
    }, context(), ports);
    expect(ports.setStatus).not.toHaveBeenCalled();
    expect(ports.clearListError).not.toHaveBeenCalled();
  });

  it("throws for unknown folder kinds", () => {
    const ports = createPorts();
    const unknownState: FolderState = { kind: "idle" };
    Object.defineProperty(unknownState, "kind", { value: "unknown" });
    expect(() => applyFolderStatus(unknownState, context(), ports)).toThrow(
      /Unexpected value in folder state/
    );
  });
});
