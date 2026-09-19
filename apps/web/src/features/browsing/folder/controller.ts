import type { FileEntry } from "@davora/shared";

import type { FolderEvent, FolderRequest } from "./model";
import type { FolderLoadOutcome, FolderPorts } from "./ports";

export type FolderMode = "online" | "offline" | "server-unavailable" | "explicit-offline";

export interface FolderLoadInput {
  readonly request: FolderRequest;
  readonly token?: string;
  readonly mode: FolderMode;
  readonly preferCache: boolean;
  readonly announceStatus: boolean;
  readonly explicitOfflineItems: FileEntry[];
  readonly signal: AbortSignal;
}

export interface FolderControllerCallbacks {
  emit(event: FolderEvent): boolean;
  onSessionTerminated(reason: "unauthorized" | "reconnect-required", error: Error): void;
  onWorkerUnavailable(): void;
  onWorkerAvailable(): void;
}

const cacheMissError = (mode: "offline" | "server-unavailable"): Error => new Error(
  mode === "offline"
    ? "Offline and no cached snapshot is available for this folder yet."
    : "The local server is unavailable and no cached snapshot is available for this folder yet."
);

const readCache = (ports: FolderPorts, cacheNamespace: string, path: string) => {
  try {
    return ports.readCachedFolder(cacheNamespace, path);
  } catch {
    return undefined;
  }
};

const writeCache = (ports: FolderPorts, cacheNamespace: string, path: string, items: FileEntry[]): void => {
  try {
    ports.writeCachedFolder(cacheNamespace, path, items);
  } catch {
    // Folder display remains usable when optional browser cache persistence fails.
  }
};

export const executeFolderLoad = async (
  input: FolderLoadInput,
  ports: FolderPorts,
  callbacks: FolderControllerCallbacks
): Promise<"session-terminated" | undefined> => {
  if (!callbacks.emit({ type: "request-started", request: input.request })) {
    return;
  }

  if (input.mode === "explicit-offline") {
    callbacks.emit({
      type: "explicit-offline-snapshot-shown",
      request: input.request,
      items: input.explicitOfflineItems
    });
    return;
  }

  const cached = input.preferCache
    ? readCache(ports, input.request.key.cacheNamespace, input.request.key.path)
    : undefined;
  if (cached) {
    const accepted = callbacks.emit({
      type: "cached-snapshot-shown",
      request: input.request,
      items: cached.items,
      ...(cached.cachedAt ? { cachedAt: cached.cachedAt } : {}),
      mode: input.mode
    });
    if (!accepted || input.mode !== "online") {
      return;
    }
  } else if (input.mode === "offline" || input.mode === "server-unavailable") {
    callbacks.emit({
      type: "load-failed",
      request: input.request,
      error: cacheMissError(input.mode),
      reason: input.mode === "offline" ? "offline-cache-miss" : "server-cache-miss"
    });
    return;
  }

  if (!input.token || input.signal.aborted) {
    callbacks.emit({ type: "request-cancelled", request: input.request });
    return;
  }

  let outcome: FolderLoadOutcome;
  try {
    outcome = await ports.loadFolder({
      path: input.request.key.path,
      token: input.token,
      signal: input.signal
    });
  } catch (error) {
    outcome = { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") };
  }

  switch (outcome.kind) {
    case "success": {
      const accepted = callbacks.emit({
        type: "live-response-accepted",
        request: input.request,
        items: outcome.items,
        message: input.announceStatus ? (cached ? "refreshed" : "viewing") : "silent"
      });
      if (!accepted) {
        return;
      }
      writeCache(ports, input.request.key.cacheNamespace, input.request.key.path, outcome.items);
      callbacks.onWorkerAvailable();
      return;
    }
    case "cancelled":
      callbacks.emit({ type: "request-cancelled", request: input.request });
      return;
    case "unauthorized":
    case "reconnect-required":
      if (!callbacks.emit({ type: "request-cancelled", request: input.request })) {
        return;
      }
      callbacks.onSessionTerminated(outcome.kind, outcome.error);
      return "session-terminated";
    case "transient":
      if (cached) {
        if (callbacks.emit({ type: "refresh-failed", request: input.request, items: cached.items })) {
          callbacks.onWorkerUnavailable();
        }
        return;
      }
      if (callbacks.emit({ type: "load-failed", request: input.request, error: outcome.error, reason: "live-failure" })) {
        callbacks.onWorkerUnavailable();
      }
      return;
    case "failure":
      callbacks.emit(cached
        ? { type: "refresh-failed", request: input.request, items: cached.items }
        : { type: "load-failed", request: input.request, error: outcome.error, reason: "live-failure" });
      return;
  }
};
