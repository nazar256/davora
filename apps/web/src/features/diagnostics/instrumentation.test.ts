import { describe, expect, it, vi } from "vitest";

import type { FolderPorts, SearchPorts } from "../browsing";
import type { OperationRuntimePort } from "../operations";
import type {
  PreviewAcquisition,
  PreviewCachePort,
  PreviewLivePort,
  PreviewMaterial,
  PreviewSessionAdapterBundle
} from "../preview/session";
import { createPreviewRequestKey } from "../preview/session";
import { BackendNetworkBlockedError } from "../../lib/networkPolicy";
import {
  wrapDiagnosticsFolderPorts,
  wrapDiagnosticsOperationRuntime,
  wrapDiagnosticsPreviewSession,
  wrapDiagnosticsSearchPorts
} from "./instrumentation";
import type { DiagnosticsWorkspaceCommands } from "./workspace/ports";
import { createFakeDiagnosticsClock } from "./testing/fakes";

const commands = (): DiagnosticsWorkspaceCommands & { calls: string[]; events: unknown[] } => {
  const calls: string[] = [];
  const events: unknown[] = [];
  return {
    calls,
    events,
    openReport: vi.fn(),
    closeReport: vi.fn(),
    clearData: vi.fn(),
    exportReport: vi.fn(async () => undefined),
    uploadReport: vi.fn(async () => undefined),
    recordAction: (action) => { calls.push(`invoke:${action}`); },
    recordActionResult: (action, outcome, _duration, errorKind) => {
      calls.push(`result:${action}:${outcome}${errorKind ? `:${errorKind}` : ""}`);
    },
    record: (event) => { calls.push(`event:${event.kind}`); events.push(event); },
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

const previewKey = (path = "Docs/photo.heic") => createPreviewRequestKey({
  requestSequence: 0,
  accountId: "account-1",
  cacheNamespace: "ns-1",
  path,
  contextGeneration: "gen-1",
  connectionMode: "online",
  heicPreviewEnabled: true,
  freshnessIntervalMs: 60_000,
  cacheLimitBytes: 1_000_000
});

const previewAbort = () => ({ id: "abort-1", abort: () => undefined });

const previewAcquisition = (unsupportedReason?: string): PreviewAcquisition => ({
  snapshot: {
    preview: {
      path: "Docs/photo.heic",
      name: "photo.heic",
      isFolder: false,
      viewer: unsupportedReason === undefined ? "image" : "unsupported",
      content: "",
      encoding: "none",
      truncated: false,
      bytesRead: 0,
      ...(unsupportedReason === undefined ? {} : { unsupportedReason })
    },
    fingerprint: "fp-1",
    source: "blob",
    unsupported: unsupportedReason === undefined ? "none" : "heic-fallback"
  }
});

const previewBundle = (input: {
  acquire?: PreviewLivePort["acquire"];
  read?: PreviewCachePort["read"];
}): PreviewSessionAdapterBundle => ({
  cache: {
    read: input.read ?? (async () => undefined),
    write: async () => ({ kind: "skipped" as const, reason: "not-cacheable" as const })
  },
  live: { acquire: input.acquire ?? (async () => previewAcquisition()) },
  abort: { create: previewAbort },
  resources: {
    apply: (material: PreviewMaterial) => ({ id: material.id, kind: material.kind }),
    release: () => undefined
  },
  failures: { classify: () => ({ kind: "ordinary" as const, message: "x" }) },
  prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" as const }) },
  clock: { now: () => Date.now() },
  resolveResourceUrl: () => undefined
});

describe("preview diagnostics instrumentation", () => {
  it("records preview-open success for a normal acquisition", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsPreviewSession(
      { createSessionAdapters: () => previewBundle({}) },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await wrapped.live.acquire(previewKey("Docs/plain.png"), previewAbort());
    expect(spy.calls).toEqual(["invoke:preview-open", "result:preview-open:success"]);
    expect(spy.events).toEqual([]);
  });

  it("records a partial preview-open plus error.reported for heic-fallback acquisitions", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsPreviewSession(
      {
        createSessionAdapters: () => previewBundle({
          acquire: async () => previewAcquisition("HEIC preview could not be decoded locally: canvas unavailable")
        })
      },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await wrapped.live.acquire(previewKey("Private/photo.heic"), previewAbort());
    expect(spy.calls).toEqual([
      "invoke:preview-open",
      "event:error.reported",
      "result:preview-open:partial:heic-decode-failed"
    ]);
    expect(spy.events[0]).toMatchObject({
      kind: "error.reported",
      area: "preview",
      errorKind: "heic-decode-failed",
      detail: "HEIC preview could not be decoded locally: canvas unavailable"
    });
    expect(JSON.stringify(spy.events)).not.toContain("Private/photo.heic");
  });

  it("classifies disabled and size-limit HEIC fallbacks distinctly", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsPreviewSession(
      {
        createSessionAdapters: () => previewBundle({
          acquire: async () => previewAcquisition("HEIC preview is limited to files up to 25 MB.")
        })
      },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await wrapped.live.acquire(previewKey(), previewAbort());
    expect(spy.events[0]).toMatchObject({ kind: "error.reported", errorKind: "heic-size-limit" });
  });

  it("records preview-open failures with the API error code and rethrows", async () => {
    const spy = commands();
    const apiError = Object.assign(new Error("The server returned an invalid response."), { code: "invalid_response" });
    const wrapped = wrapDiagnosticsPreviewSession(
      { createSessionAdapters: () => previewBundle({ acquire: async () => { throw apiError; } }) },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await expect(wrapped.live.acquire(previewKey(), previewAbort())).rejects.toThrow("invalid response");
    expect(spy.calls).toEqual([
      "invoke:preview-open",
      "result:preview-open:failure:invalid_response",
      "event:error.reported"
    ]);
    expect(spy.events[0]).toMatchObject({ kind: "error.reported", area: "preview", errorKind: "invalid_response" });
  });

  it("records aborted and offline-blocked preview opens as cancelled without error events", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsPreviewSession(
      {
        createSessionAdapters: () => previewBundle({
          acquire: async () => { throw new BackendNetworkBlockedError(); }
        })
      },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await expect(wrapped.live.acquire(previewKey(), previewAbort())).rejects.toThrow();
    expect(spy.calls).toEqual(["invoke:preview-open", "result:preview-open:cancelled:BackendNetworkBlockedError"]);
    expect(spy.events).toEqual([]);
  });

  it("reports heic-fallback acquisitions surfaced through the cache path", async () => {
    const spy = commands();
    const wrapped = wrapDiagnosticsPreviewSession(
      {
        createSessionAdapters: () => previewBundle({
          read: async () => ({
            acquisition: previewAcquisition("HEIC preview could not be decoded locally: worker crashed"),
            cachedAtMs: 1
          })
        })
      },
      { current: spy },
      createFakeDiagnosticsClock()
    ).createSessionAdapters({ tokenFor: () => "token" });

    await wrapped.cache.read(previewKey(), previewAbort());
    expect(spy.calls).toEqual(["event:error.reported"]);
    expect(spy.events[0]).toMatchObject({
      kind: "error.reported",
      area: "preview",
      errorKind: "heic-decode-failed"
    });
  });
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

  it("records sanitized folder response rejection evidence before the terminal load event", async () => {
    const spy = commands();
    const base = folderPorts({
      loadFolder: async () => ({
        kind: "failure" as const,
        error: new Error("invalid"),
        diagnostic: {
          phase: "basename-mismatch" as const,
          itemIndex: 2,
          itemShape: {
            presentKeys: ["isFolder", "name", "path"],
            fieldTypes: { isFolder: "boolean" as const, name: "string" as const, path: "string" as const },
            isFolder: false,
            pathDepth: 2,
            nameLength: 4,
            flags: { hasControl: false, hasEdgeWhitespace: false, nonNfc: false }
          }
        }
      })
    });
    const wrapped = wrapDiagnosticsFolderPorts(base, { current: spy }, createFakeDiagnosticsClock());

    await wrapped.loadFolder({ path: "Private/Folder", token: "t", signal: new AbortController().signal });

    expect(spy.calls).toEqual([
      "event:folder.response.rejected",
      "event:folder.load",
      "event:error.reported"
    ]);
    expect(spy.events[0]).toMatchObject({
      kind: "folder.response.rejected",
      path: { alias: "path-1", depth: 1 },
      rejection: { phase: "basename-mismatch", itemIndex: 2 }
    });
    expect(spy.events[1]).toMatchObject({ kind: "folder.load", errorKind: "basename-mismatch" });
    expect(JSON.stringify(spy.events)).not.toContain("Private/Folder");
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
      time: { wait: async () => {} }, uploadFiles: { prepare: vi.fn() },
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
