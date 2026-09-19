import type { FilePreview } from "@davora/shared";
import { basename, getViewerKind } from "@davora/shared";

import type { RetentionCommand, RetentionCommandOutcome } from "../retention";
import { retainedRootId, type RetainedFile, type RetentionAccount } from "../retention";
import type { OfflineSyncRetentionPort } from "./orchestrationPorts";
import type { OfflineSyncActionResult } from "./ports";
import {
  OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE,
  OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE
} from "./presentation";
import { classifyOfflineSyncPlanError, type OfflineSyncErrorClassifierDeps } from "./planAdapters";

type SnapshotCommand = Exclude<RetentionCommand, { readonly kind: "readPreview" }>;

export function mapRetentionOutcomeToAction(
  result: { kind: "completed" | "failed" | "superseded"; message?: string },
  cancellation: { readonly aborted: boolean }
): OfflineSyncActionResult {
  if (result.kind === "failed") {
    return { kind: "ordinaryFailure", message: result.message ?? "Retention command failed." };
  }
  if (result.kind === "superseded") {
    return { kind: "cancelled", reason: cancellation.aborted ? "aborted" : "superseded" };
  }
  return { kind: "success" };
}

export function createCachedPreviewFromBlob(
  path: string,
  blob: Blob,
  fallbackName?: string,
  fallbackSize?: number
): FilePreview {
  const mimeType = blob.type || "application/octet-stream";
  const viewer = getViewerKind(mimeType);
  const name = fallbackName ?? basename(path);
  if (viewer === "text" || viewer === "markdown") {
    return {
      path,
      name,
      isFolder: false,
      mimeType,
      viewer,
      content: "",
      encoding: "utf8",
      truncated: false,
      bytesRead: blob.size,
      requiresOriginalBlob: false,
      size: fallbackSize ?? blob.size
    };
  }

  return {
    path,
    name,
    isFolder: false,
    mimeType,
    viewer,
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    requiresOriginalBlob: viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf",
    size: fallbackSize ?? blob.size
  };
}

function createRetainedFile(input: {
  path: string;
  preview: FilePreview;
  blob?: Blob;
  mimeType: string;
  filename: string;
  size?: number;
  normalCacheOwnership?: "none" | "owned";
}): RetainedFile {
  return {
    path: input.path,
    name: input.preview.name || input.filename,
    mimeType: input.mimeType,
    size: input.size ?? input.preview.size ?? input.blob?.size ?? 0,
    preview: input.preview,
    blobSize: input.blob?.size ?? 0,
    readable: input.blob !== undefined,
    normalCacheOwnership: input.normalCacheOwnership ?? "owned"
  };
}

export interface OfflineSyncRetentionDeps {
  readonly getActiveAccount: () => { readonly id: string; readonly cacheNamespace: string } | undefined;
  readonly toRetentionAccount: (account: { readonly id: string; readonly cacheNamespace: string }) => RetentionAccount;
  readonly executeSnapshotCommand: (
    command: SnapshotCommand,
    operationIsCurrent?: () => boolean
  ) => Promise<RetentionCommandOutcome>;
  readonly readBlobText: (blob: Blob) => Promise<string>;
  readonly errors: OfflineSyncErrorClassifierDeps;
}

export function createOfflineSyncRetentionPort(deps: OfflineSyncRetentionDeps): OfflineSyncRetentionPort {
  return {
    beginRoot: async (job, checkStillOwned) => {
      const activeAccount = deps.getActiveAccount();
      if (!activeAccount) {
        return { kind: "ordinaryFailure", message: "No session available for offline sync." };
      }
      const result = await deps.executeSnapshotCommand({
        kind: "beginRoot",
        account: deps.toRetentionAccount(activeAccount),
        root: {
          rootPath: job.root.path,
          rootName: job.root.name,
          kind: job.root.kind,
          folderRoots: job.root.folderRoots
        }
      }, checkStillOwned);
      return mapRetentionOutcomeToAction(result, { aborted: false });
    },
    persistRetainedFile: async (job, file, response, signal, checkStillOwned) => {
      try {
        if (!checkStillOwned() || signal.aborted) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        const activeAccount = deps.getActiveAccount();
        if (!activeAccount) {
          return { kind: "ordinaryFailure", message: "No session available for offline sync." };
        }
        let preview = createCachedPreviewFromBlob(
          file.sourcePath,
          response.blob,
          response.filename ?? basename(file.sourcePath),
          file.size
        );
        if (preview.viewer === "text" || preview.viewer === "markdown") {
          const content = await deps.readBlobText(response.blob);
          preview = { ...preview, content, bytesRead: content.length };
        }
        if (!checkStillOwned() || signal.aborted) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        const result = await deps.executeSnapshotCommand({
          kind: "persistRetainedFile",
          account: deps.toRetentionAccount(activeAccount),
          input: {
            rootId: retainedRootId({ kind: job.root.kind, rootPath: job.root.path }),
            file: createRetainedFile({
              path: file.sourcePath,
              preview,
              blob: response.blob,
              mimeType: response.blob.type || "application/octet-stream",
              filename: response.filename ?? basename(file.sourcePath),
              normalCacheOwnership: "none"
            }),
            blob: response.blob
          }
        }, checkStillOwned);
        return mapRetentionOutcomeToAction(result, { aborted: signal.aborted });
      } catch (error) {
        if (!checkStillOwned()) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        if (deps.errors.isUnauthorized(error)) {
          return { kind: "sessionTerminal", reason: "unauthorized", message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE };
        }
        if (deps.errors.isReconnectRequired(error)) {
          return { kind: "sessionTerminal", reason: "reconnectRequired", message: OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE };
        }
        return { kind: "ordinaryFailure", message: error instanceof Error ? error.message : "Unable to cache this file for offline use." };
      }
    },
    completeRoot: async (job, signal, checkStillOwned) => {
      try {
        if (!checkStillOwned() || signal.aborted) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        const activeAccount = deps.getActiveAccount();
        if (!activeAccount) {
          return { kind: "ordinaryFailure", message: "No session available for offline sync." };
        }
        const result = await deps.executeSnapshotCommand({
          kind: "completeRoot",
          account: deps.toRetentionAccount(activeAccount),
          rootId: retainedRootId({ kind: job.root.kind, rootPath: job.root.path })
        }, checkStillOwned);
        return mapRetentionOutcomeToAction(result, { aborted: signal.aborted });
      } catch (error) {
        if (!checkStillOwned()) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        if (deps.errors.isUnauthorized(error)) {
          return { kind: "sessionTerminal", reason: "unauthorized", message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE };
        }
        if (deps.errors.isReconnectRequired(error)) {
          return { kind: "sessionTerminal", reason: "reconnectRequired", message: OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE };
        }
        return { kind: "ordinaryFailure", message: error instanceof Error ? error.message : "Unable to finish offline sync." };
      }
    },
    readSummary: async (_namespace, signal, checkStillOwned) => {
      try {
        if (!checkStillOwned() || signal.aborted) {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        const activeAccount = deps.getActiveAccount();
        if (!activeAccount) {
          return { kind: "ordinaryFailure", message: "No session available for offline sync." };
        }
        const result = await deps.executeSnapshotCommand({
          kind: "readSnapshot",
          account: deps.toRetentionAccount(activeAccount)
        }, checkStillOwned);
        if (result.kind === "failed") {
          return { kind: "ordinaryFailure", message: result.message };
        }
        if (result.kind === "superseded") {
          return { kind: "cancelled", reason: signal.aborted ? "aborted" : "superseded" };
        }
        if (!result.snapshot) {
          return { kind: "ordinaryFailure", message: "Unable to refresh offline storage summary." };
        }
        return { kind: "success", value: result.snapshot };
      } catch (error) {
        return classifyOfflineSyncPlanError(error, "Unable to refresh offline storage summary.", checkStillOwned, signal, deps.errors);
      }
    }
  };
}
