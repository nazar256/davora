import { describe, expect, it, vi } from "vitest";

import type { FolderPorts, SearchPorts } from "../browsing";
import type { OperationRuntimePort } from "../operations";
import { BackendNetworkBlockedError } from "../../lib/networkPolicy";
import {
  wrapDiagnosticsFolderPorts,
  wrapDiagnosticsOperationRuntime,
  wrapDiagnosticsSearchPorts
} from "./instrumentation";
import type { DiagnosticsWorkspaceCommands } from "./workspace/ports";
import { createFakeDiagnosticsClock } from "./testing/fakes";

const commands = (): DiagnosticsWorkspaceCommands & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    openReport: vi.fn(),
    closeReport: vi.fn(),
    clearData: vi.fn(),
    exportReport: vi.fn(async () => undefined),
    recordAction: (action) => { calls.push(`invoke:${action}`); },
    recordActionResult: (action, outcome, _duration, errorKind) => {
      calls.push(`result:${action}:${outcome}${errorKind ? `:${errorKind}` : ""}`);
    },
    record: (event) => { calls.push(`event:${event.kind}`); },
    redactPath: (_path) => ({ alias: "path-1", depth: 1, kind: undefined })
  };
};

const folderPorts = (overrides: Partial<FolderPorts> = {}): FolderPorts => ({
  createAbortHandle: () => ({ signal: new AbortController().signal, abort: () => undefined }),
  loadFolder: async () => ({ kind: "success", items: [] }),
  readCachedFolder: () => undefined,
  writeCachedFolder: () => undefined,
  ...overrides
});

const searchPorts = (overrides: Partial<SearchPorts> = {}): SearchPorts => ({
  createAbortHandle: () => ({ signal: new AbortController().signal, abort: () => undefined }),
  loadSearch: async () => ({ kind: "success", items: [] }),
  readCachedSearch: () => undefined,
  writeCachedSearch: () => undefined,
  ...overrides
});

describe("diagnostics instrumentation", () => {
  it("records successful folder loads with duration and item count", async () => {
    const spy = commands();
    const ref = { current: spy };
    const base = folderPorts({
      loadFolder: async () => ({
        kind: "success" as const,
        items: [{ path: "Docs/a", name: "a", isFolder: false }]
      })
    });
    const wrapped = wrapDiagnosticsFolderPorts(base, ref, createFakeDiagnosticsClock());

    const outcome = await wrapped.loadFolder({ path: "Docs", token: "t", signal: new AbortController().signal });
    expect(outcome.kind).toBe("success");
    expect(spy.calls).toEqual(["event:folder.load"]);
  });

  it("records offline-blocked folder loads without an error.reported event", async () => {
    const spy = commands();
    const base = folderPorts({
      loadFolder: async () => ({ kind: "failure", error: new BackendNetworkBlockedError() })
    });
    const wrapped = wrapDiagnosticsFolderPorts(base, { current: spy }, createFakeDiagnosticsClock());

    await wrapped.loadFolder({ path: "Docs", token: "t", signal: new AbortController().signal });
    expect(spy.calls).toEqual(["event:folder.load"]);
  });

  it("records failed folder loads with an error.reported event", async () => {
    const spy = commands();
    const base = folderPorts({
      loadFolder: async () => ({ kind: "failure", error: new Error("HTTP 500") })
    });
    const wrapped = wrapDiagnosticsFolderPorts(base, { current: spy }, createFakeDiagnosticsClock());

    await wrapped.loadFolder({ path: "Docs", token: "t", signal: new AbortController().signal });
    expect(spy.calls).toEqual(["event:folder.load", "event:error.reported"]);
  });

  it("records search outcomes through action results", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsSearchPorts(searchPorts({
      loadSearch: async () => ({ kind: "success", items: [] })
    }), { current: spy }, createFakeDiagnosticsClock());
    await wrapped.loadSearch({ path: "", query: "a", token: "t", signal: new AbortController().signal });
    expect(spy.calls).toEqual(["result:search:success"]);
  });

  it("wraps mutation calls with action lifecycle events and rethrows failures", async () => {
    const spy = commands();
    const mutationResult = { action: "createFolder" as const, parentPath: "Docs", path: "Docs/new" };
    const base: OperationRuntimePort = {
      request: {
        createAbortHandle: () => ({ signal: new AbortController().signal, abort: () => undefined }),
        createTransferId: () => "t-1"
      },
      mutation: {
        createFolder: vi.fn(async () => mutationResult),
        deleteFile: vi.fn(async (): Promise<never> => { throw new Error("denied"); }),
        copyOrMove: vi.fn(async () => ({ ...mutationResult, action: "copy" as const })),
        uploadFile: vi.fn(async () => ({ ...mutationResult, action: "upload" as const })),
        listDestination: vi.fn(async () => ({ items: [] }))
      },
      download: {
        prepareDownloadFile: vi.fn(async () => ({ blob: new Blob(["x"]), filename: "f" })),
        fetchDownloadBlob: vi.fn(async () => ({ blob: new Blob(["x"]) })),
        listFiles: vi.fn(async () => ({ items: [] })),
        triggerBrowserDownload: vi.fn(),
        saveDownload: vi.fn()
      },
      batch: {
        downloadSelectionAsZip: vi.fn(async () => ({
          blob: new Blob(["x"]),
          plan: {
            archiveName: "a.zip",
            selectedCount: 0,
            selectedFileCount: 0,
            selectedDirectoryCount: 0,
            directories: [],
            files: [],
            failedFiles: []
          }
        }))
      },
      preview: { createFileStreamUrl: vi.fn(async () => "") },
      uploadFiles: { prepare: vi.fn() },
      isUnauthorized: () => false,
      isReconnectRequired: () => false,
      toErrorMessage: (error) => (error instanceof Error ? error.message : "failed")
    };

    const wrapped = wrapDiagnosticsOperationRuntime(base, { current: spy }, createFakeDiagnosticsClock());
    await wrapped.mutation.createFolder("Docs", "new", "t");
    await expect(wrapped.mutation.deleteFile("Docs/a", "a", "t")).rejects.toThrow("denied");

    expect(spy.calls).toEqual([
      "invoke:create-folder",
      "result:create-folder:success",
      "invoke:delete",
      "result:delete:failure:Error"
    ]);
  });

  it("uses the live commands reference so late-bound commands receive events", async () => {
    const first = commands();
    const second = commands();
    const ref = { current: first as DiagnosticsWorkspaceCommands };
    const wrapped = wrapDiagnosticsSearchPorts(searchPorts(), ref, createFakeDiagnosticsClock());

    ref.current = second;
    await wrapped.loadSearch({ path: "", query: "a", token: "t", signal: new AbortController().signal });
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(["result:search:success"]);
  });
});
