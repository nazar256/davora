import type { FileEntry } from "@davora/shared";

import { buildBatchDownloadPlan } from "../../../lib/batchDownload";
import { buildOfflineSyncSupersededError } from "./orchestration";
import type { OfflineSyncArchiveInput, OfflineSyncPlan } from "./model";
import type { OfflineSyncValueResult } from "./ports";
import {
  OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE,
  OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE
} from "./presentation";

export interface OfflineSyncPlanDeps {
  readonly token: string;
  readonly cacheNamespace?: string;
  readonly listFiles: (path: string, token: string, signal?: AbortSignal) => Promise<{ completeness: "complete" | "partial"; items: FileEntry[] }>;
  readonly cacheFolder?: (namespace: string, path: string, items: FileEntry[], completeness: "complete" | "partial") => void;
}

export interface OfflineSyncPlanOptions {
  readonly signal?: AbortSignal;
  readonly checkStillOwned?: () => boolean;
}

export interface OfflineSyncErrorClassifierDeps {
  readonly isUnauthorized: (error: unknown) => boolean;
  readonly isReconnectRequired: (error: unknown) => boolean;
}

export async function buildOfflineSyncPlanFromArchive(
  archiveInput: OfflineSyncArchiveInput,
  deps: OfflineSyncPlanDeps,
  options: OfflineSyncPlanOptions = {}
): Promise<OfflineSyncPlan> {
  const plan = await buildBatchDownloadPlan({
    roots: archiveInput.roots.map((root) => ({
      entry: root.entry,
      archiveRoot: root.archiveRoot
    })),
    archiveLabel: archiveInput.archiveLabel,
    listFiles: async (path) => {
      if (options.checkStillOwned && (!options.checkStillOwned() || options.signal?.aborted)) {
        throw buildOfflineSyncSupersededError();
      }
      const response = options.signal === undefined
        ? await deps.listFiles(path, deps.token)
        : await deps.listFiles(path, deps.token, options.signal);
      if (options.checkStillOwned && (!options.checkStillOwned() || options.signal?.aborted)) {
        throw buildOfflineSyncSupersededError();
      }
      if (deps.cacheNamespace && deps.cacheFolder) {
        deps.cacheFolder(deps.cacheNamespace, path, response.items, response.completeness);
      }
      return response;
    }
  });
  return {
    files: plan.files.map((file) => ({
      sourcePath: file.sourcePath,
      ...(file.size === undefined ? {} : { size: file.size })
    })),
    ...(plan.totalBytes === undefined ? {} : { totalBytes: plan.totalBytes })
  };
}

export function classifyOfflineSyncPlanError<T>(
  error: unknown,
  fallback: string,
  checkStillOwned: () => boolean,
  signal: AbortSignal,
  errors: OfflineSyncErrorClassifierDeps
): Exclude<OfflineSyncValueResult<T>, { readonly kind: "success" }> {
  if (!checkStillOwned()) {
    return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
  }
  if (errors.isUnauthorized(error)) {
    return { kind: "sessionTerminal", reason: "unauthorized", message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE };
  }
  if (errors.isReconnectRequired(error)) {
    return { kind: "sessionTerminal", reason: "reconnectRequired", message: OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE };
  }
  return { kind: "ordinaryFailure", message: error instanceof Error ? error.message : fallback };
}
