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
