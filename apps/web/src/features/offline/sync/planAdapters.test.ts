import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { buildOfflineSyncSupersededError } from "./orchestration";
import {
  buildOfflineSyncPlanFromArchive,
  classifyOfflineSyncPlanError
} from "./planAdapters";

const archiveInput = {
  roots: [{ entry: { path: "Projects", name: "Projects", isFolder: true }, archiveRoot: "Projects" }],
  archiveLabel: "projects"
} as const;

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

describe("buildOfflineSyncPlanFromArchive", () => {
  it("lists files with the session token and caches folder listings", async () => {
    const listFiles = vi.fn(async (path: string) => ({ completeness: "complete" as const,
      items: path === "Projects"
        ? [entry("Projects/a.txt"), entry("Projects/b.txt")]
        : []
    }));
    const cacheFolder = vi.fn();

    const plan = await buildOfflineSyncPlanFromArchive(archiveInput, {
      token: "token-alpha",
      cacheNamespace: "ns-alpha",
      listFiles,
      cacheFolder
    });

    expect(listFiles).toHaveBeenCalledWith("Projects", "token-alpha");
    expect(cacheFolder).toHaveBeenCalledWith("ns-alpha", "Projects", expect.any(Array), "complete");
    expect(plan.files.map((file) => file.sourcePath)).toEqual(["Projects/a.txt", "Projects/b.txt"]);
    expect(plan.totalBytes).toBeUndefined();
  });

  it("throws a superseded error when ownership is lost around listFiles", async () => {
    let owned = true;
    const listFiles = vi.fn(async () => {
      owned = false;
      return { completeness: "complete" as const, items: [entry("Projects/a.txt")] };
    });

    await expect(buildOfflineSyncPlanFromArchive(archiveInput, {
      token: "token-alpha",
      listFiles
    }, {
      checkStillOwned: () => owned
    })).rejects.toEqual(buildOfflineSyncSupersededError());
  });

  it("throws a superseded error when the abort signal is set before caching", async () => {
    const controller = new AbortController();
    const listFiles = vi.fn(async () => {
      controller.abort();
      return { completeness: "complete" as const, items: [entry("Projects/a.txt")] };
    });

    await expect(buildOfflineSyncPlanFromArchive(archiveInput, {
      token: "token-alpha",
      listFiles
    }, {
      signal: controller.signal,
      checkStillOwned: () => true
    })).rejects.toEqual(buildOfflineSyncSupersededError());
  });

  it("forwards the estimate signal and stops recursive listing after cancellation", async () => {
    const controller = new AbortController();
    const listFiles = vi.fn(async (path: string, _token: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return { completeness: "complete" as const, items: [entry(`${path}/child`, true)] };
    });
    const cacheFolder = vi.fn();

    await expect(buildOfflineSyncPlanFromArchive(archiveInput, {
      token: "token-alpha",
      listFiles,
      cacheFolder
    }, {
      signal: controller.signal,
      checkStillOwned: () => !controller.signal.aborted
    })).rejects.toEqual(buildOfflineSyncSupersededError());
    expect(listFiles).toHaveBeenCalledOnce();
    expect(cacheFolder).not.toHaveBeenCalled();
  });
});

describe("classifyOfflineSyncPlanError", () => {
  const errors = {
    isUnauthorized: (error: unknown) => error instanceof Error && error.name === "Unauthorized",
    isReconnectRequired: (error: unknown) => error instanceof Error && error.name === "ReconnectRequired"
  };

  it("classifies unauthorized and reconnect-required failures", () => {
    const signal = new AbortController().signal;
    expect(classifyOfflineSyncPlanError(
      Object.assign(new Error("expired"), { name: "Unauthorized" }),
      "fallback",
      () => true,
      signal,
      errors
    )).toEqual({
      kind: "sessionTerminal",
      reason: "unauthorized",
      message: "Session expired. Create a fresh session for this account."
    });
    expect(classifyOfflineSyncPlanError(
      Object.assign(new Error("reconnect"), { name: "ReconnectRequired" }),
      "fallback",
      () => true,
      signal,
      errors
    )).toEqual({
      kind: "sessionTerminal",
      reason: "reconnectRequired",
      message: "This account needs to be reconnected before syncing files."
    });
  });

  it("returns cancelled when ownership is lost and otherwise ordinary failure", () => {
    const signal = new AbortController().signal;
    expect(classifyOfflineSyncPlanError(new Error("network"), "fallback", () => false, signal, errors))
      .toEqual({ kind: "cancelled", reason: "superseded" });
    expect(classifyOfflineSyncPlanError(new Error("network"), "fallback", () => true, signal, errors))
      .toEqual({ kind: "ordinaryFailure", message: "network" });
  });
});
