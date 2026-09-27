/**
 * Service-port instrumentation wrappers.
 *
 * Each wrapper preserves the wrapped object's public shape exactly and emits
 * diagnostic events through the injected command accessor. When diagnostics
 * are disabled the commands are no-ops, so wrapped services behave identically.
 * No browser globals are touched here — timing comes from the clock port.
 */

import type { FolderPorts, SearchPorts } from "../browsing";
import type { OperationRuntimePort } from "../operations";
import type {
  PreviewCachePort,
  PreviewLivePort,
  PreviewSessionCompositionFactories
} from "../preview/session";
import { isHeicFileName } from "../../lib/heicPreviewShared";
import { BackendNetworkBlockedError } from "../../lib/networkPolicy";
import type { DiagnosticActionName } from "./model";
import type { DiagnosticsClock } from "./ports";
import type { DiagnosticsWorkspaceCommands } from "./workspace/ports";

interface CommandsRef {
  readonly current: DiagnosticsWorkspaceCommands;
}

const errorKindOf = (error: unknown): string =>
  error instanceof Error ? error.name : "Error";

const wrapTimed = <Args extends readonly unknown[], Result>(
  commands: CommandsRef,
  clock: DiagnosticsClock,
  action: DiagnosticActionName,
  fn: (...args: Args) => Promise<Result>,
  detail?: (args: Args) => Record<string, string | number | boolean> | undefined
): ((...args: Args) => Promise<Result>) => {
  return async (...args: Args) => {
    const started = clock.nowMs();
    commands.current.recordAction(action, detail?.(args));
    try {
      const result = await fn(...args);
      commands.current.recordActionResult(action, "success", Math.round(clock.nowMs() - started));
      return result;
    } catch (error) {
      const outcome = error instanceof BackendNetworkBlockedError ? "cancelled" : "failure";
      commands.current.recordActionResult(action, outcome, Math.round(clock.nowMs() - started), errorKindOf(error));
      throw error;
    }
  };
};

export const wrapDiagnosticsFolderPorts = (
  base: FolderPorts,
  commands: CommandsRef,
  clock: DiagnosticsClock
): FolderPorts => ({
  ...base,
  loadFolder: async (input) => {
    const started = clock.nowMs();
    const outcome = await base.loadFolder(input);
    const durationMs = Math.round(clock.nowMs() - started);
    const commandsNow = commands.current;
    if (outcome.kind === "success") {
      commandsNow.record({
        kind: "folder.load",
        outcome: "live",
        durationMs,
        itemCount: outcome.items.length
      });
    } else if (outcome.kind === "cancelled") {
      commandsNow.record({ kind: "folder.load", outcome: "cancelled", durationMs });
    } else {
      const offline = outcome.error instanceof BackendNetworkBlockedError;
      if (outcome.diagnostic) {
        commandsNow.record({
          kind: "folder.response.rejected",
          path: commandsNow.redactPath(input.path, "folder"),
          rejection: outcome.diagnostic
        });
      }
      const errorKind = outcome.diagnostic?.phase ?? outcome.kind;
      commandsNow.record({
        kind: "folder.load",
        outcome: offline ? "offline" : "failed",
        errorKind,
        durationMs
      });
      if (!offline) {
        commandsNow.record({ kind: "error.reported", area: "list", errorKind });
      }
    }
    return outcome;
  }
});

export const wrapDiagnosticsSearchPorts = (
  base: SearchPorts,
  commands: CommandsRef,
  clock: DiagnosticsClock
): SearchPorts => ({
  ...base,
  loadSearch: async (input) => {
    const started = clock.nowMs();
    const outcome = await base.loadSearch(input);
    const durationMs = Math.round(clock.nowMs() - started);
    if (outcome.kind === "success") {
      commands.current.recordActionResult("search", "success", durationMs);
    } else if (outcome.kind === "cancelled") {
      commands.current.recordActionResult("search", "cancelled", durationMs);
    } else {
      commands.current.recordActionResult("search", "failure", durationMs, outcome.kind);
      commands.current.record({ kind: "error.reported", area: "list", errorKind: outcome.kind });
    }
    return outcome;
  }
});

const HEIC_FALLBACK_DETAIL_LIMIT = 300;

const isAbortLike = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

const previewErrorKind = (error: unknown): string => {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return errorKindOf(error);
};

const heicFallbackErrorKind = (reason: string | undefined): string => {
  if (!reason) {
    return "heic-fallback";
  }
  if (reason.includes("experimental and disabled")) {
    return "heic-disabled";
  }
  if (reason.includes("limited to files up to")) {
    return "heic-size-limit";
  }
  if (reason.includes("megapixels")) {
    return "heic-pixel-limit";
  }
  if (reason.includes("timed out")) {
    return "heic-timeout";
  }
  if (reason.includes("could not be decoded locally")) {
    return "heic-decode-failed";
  }
  return "heic-fallback";
};

const reportHeicFallback = (commands: DiagnosticsWorkspaceCommands, reason: string | undefined): string => {
  const errorKind = heicFallbackErrorKind(reason);
  commands.record({
    kind: "error.reported",
    area: "preview",
    errorKind,
    ...(reason === undefined ? {} : { detail: reason.slice(0, HEIC_FALLBACK_DETAIL_LIMIT) })
  });
  return errorKind;
};

const wrapDiagnosticsPreviewAcquire = (
  acquire: PreviewLivePort["acquire"],
  commands: CommandsRef,
  clock: DiagnosticsClock
): PreviewLivePort["acquire"] => async (key, abort) => {
  const started = clock.nowMs();
  commands.current.recordAction("preview-open", {
    heic: isHeicFileName(key.path),
    mode: key.connectionMode
  });
  try {
    const acquisition = await acquire(key, abort);
    const durationMs = Math.round(clock.nowMs() - started);
    if (acquisition.snapshot.unsupported === "heic-fallback") {
      const errorKind = reportHeicFallback(commands.current, acquisition.snapshot.preview.unsupportedReason);
      commands.current.recordActionResult("preview-open", "partial", durationMs, errorKind);
    } else {
      commands.current.recordActionResult("preview-open", "success", durationMs);
    }
    return acquisition;
  } catch (error) {
    const durationMs = Math.round(clock.nowMs() - started);
    const cancelled = error instanceof BackendNetworkBlockedError || isAbortLike(error);
    const errorKind = previewErrorKind(error);
    commands.current.recordActionResult("preview-open", cancelled ? "cancelled" : "failure", durationMs, errorKind);
    if (!cancelled) {
      commands.current.record({ kind: "error.reported", area: "preview", errorKind });
    }
    throw error;
  }
};

const wrapDiagnosticsPreviewCache = (
  cache: PreviewCachePort,
  commands: CommandsRef
): PreviewCachePort => ({
  // Bundle ports may be class instances; delegate instead of spreading so
  // prototype methods and `this` survive.
  read: async (key, abort) => {
    const entry = await cache.read(key, abort);
    if (entry?.acquisition.snapshot.unsupported === "heic-fallback") {
      reportHeicFallback(commands.current, entry.acquisition.snapshot.preview.unsupportedReason);
    }
    return entry;
  },
  write: (key, acquisition, abort) => cache.write(key, acquisition, abort)
});

export const wrapDiagnosticsPreviewSession = (
  base: PreviewSessionCompositionFactories,
  commands: CommandsRef,
  clock: DiagnosticsClock
): PreviewSessionCompositionFactories => ({
  createSessionAdapters: (input) => {
    const bundle = base.createSessionAdapters(input);
    return {
      ...bundle,
      cache: wrapDiagnosticsPreviewCache(bundle.cache, commands),
      live: {
        acquire: wrapDiagnosticsPreviewAcquire(
          (key, abort) => bundle.live.acquire(key, abort),
          commands,
          clock
        )
      }
    };
  }
});

export const wrapDiagnosticsOperationRuntime = (
  base: OperationRuntimePort,
  commands: CommandsRef,
  clock: DiagnosticsClock
): OperationRuntimePort => ({
  ...base,
  mutation: {
    ...base.mutation,
    createFolder: wrapTimed(commands, clock, "create-folder", base.mutation.createFolder),
    deleteFile: wrapTimed(commands, clock, "delete", base.mutation.deleteFile),
    copyOrMove: wrapTimed(commands, clock, "copy-move", base.mutation.copyOrMove, (args) => ({ mode: args[0] })),
    uploadFile: wrapTimed(commands, clock, "upload", base.mutation.uploadFile, (args) => ({
      bytes: Math.round(args[0].contentBase64.length * 3 / 4)
    })),
    listDestination: base.mutation.listDestination
  },
  download: {
    ...base.download,
    prepareDownloadFile: wrapTimed(commands, clock, "download", base.download.prepareDownloadFile),
    fetchDownloadBlob: base.download.fetchDownloadBlob,
    listFiles: base.download.listFiles,
    triggerBrowserDownload: base.download.triggerBrowserDownload,
    saveDownload: base.download.saveDownload
  },
  batch: {
    ...base.batch,
    downloadSelectionAsZip: wrapTimed(commands, clock, "batch-download", base.batch.downloadSelectionAsZip)
  },
  uploadFiles: base.uploadFiles
});
