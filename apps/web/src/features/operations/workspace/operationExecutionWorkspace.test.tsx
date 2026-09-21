/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperationContextToken } from "../policy";
import type { OperationAuthority, OperationExecutionWorkspaceContext, OperationExecutionWorkspaceInput, OperationRuntimePort } from "./ports";
import { useOperationExecutionWorkspace } from "./index";

const file = { path: "/Docs/readme.txt", name: "readme.txt", isFolder: false };

function runtime(): OperationRuntimePort {
  const download = {
    prepareDownloadFile: vi.fn(async () => ({ blob: new Blob(["x"]), filename: "readme.txt" })),
    fetchDownloadBlob: vi.fn(async () => ({ blob: new Blob(["x"]), filename: "readme.txt" })),
    listFiles: vi.fn(async () => ({ items: [] })),
    triggerBrowserDownload: vi.fn(),
    saveDownload: vi.fn()
  };
  return {
    request: { createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; }, createTransferId: () => "transfer" },
    mutation: {
      createFolder: vi.fn(async () => ({ action: "createFolder", path: "/Docs/new" })),
      deleteFile: vi.fn(async () => ({ action: "delete", path: file.path })),
      uploadFile: vi.fn(async () => ({ action: "upload", path: file.path })),
      copyOrMove: vi.fn(async () => ({ action: "copy", path: file.path })),
      listDestination: vi.fn(async () => ({ items: [] }))
    },
    download,
    batch: { downloadSelectionAsZip: vi.fn(async () => ({ blob: new Blob(), plan: { archiveName: "docs.zip", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] } })) },
    time: { wait: vi.fn(async () => {}) },
    uploadFiles: { prepare: vi.fn(async () => ({ kind: "prepared", contentBase64: "" })) },
    isUnauthorized: (error: unknown) => Boolean(error),
    isReconnectRequired: () => false,
    toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
  } as unknown as OperationRuntimePort;
}

function input(overrides: Partial<OperationExecutionWorkspaceInput["context"]> = {}): OperationExecutionWorkspaceInput {
  const selectedPreview = { path: file.path, name: file.name };
  const context: OperationExecutionWorkspaceContext = { accountId: "alpha", accountName: "Alpha", token: "token", capabilities: {
    backend: "mock", readOnly: false, search: true, preview: true, download: true, offlineCache: true,
    createFolder: true, upload: true, move: true, copy: true, delete: true, mediaPreview: true, markdownPreview: true, openedFileCache: true
  }, currentPath: "/Docs", cacheOnlyMode: false, explicitOffline: false, browserOffline: false, workerUnavailable: false, isNarrowScreen: false, ...overrides };
  const authority: OperationAuthority = {
    token: OperationContextToken.create(),
    environment: { mode: "online", hasSession: Boolean(context.token), capabilities: context.capabilities },
    registry: { acquire: () => undefined },
    isOperationAllowed: () => true,
    isOperationAllowedForRender: () => true,
    isOperationContextAllowed: () => true,
    isCurrentOperationHandler: () => true,
    isCurrentOperationContext: () => true,
    getCurrentOperationContextToken: () => authority.token,
    getCurrentCapabilities: () => undefined,
    capabilitiesMatch: () => true
  };
  return {
    authority,
    context,
    selection: {
      focusedEntry: file,
      batchSelectionEntries: [],
      focused: { current: () => file, select: vi.fn(), clear: vi.fn(), clearIfCurrent: vi.fn(), rebindIfCurrent: vi.fn(), removeDeleted: vi.fn(), capture: vi.fn(() => undefined), isCurrent: () => true, showMobileActions: vi.fn() },
      batch: { removeDeleted: vi.fn(), rebind: vi.fn(), retain: vi.fn(), clear: vi.fn(), removeCaptured: vi.fn(), isSelected: () => false, toggle: vi.fn(), capture: () => ({ memberships: [] }) as never },
      archiveInput: { roots: [], archiveLabel: "docs" },
      clearBatch: vi.fn(),
      selectedPreview: undefined,
      selectedPreviewPort: { get: () => selectedPreview, set: vi.fn(), closePreview: vi.fn() }
    },
    coordination: {
      session: { resetActiveSession: vi.fn() },
      refresh: { getCurrentPath: () => "/Docs", setCurrentPath: vi.fn(), loadFolder: vi.fn(async () => ({ kind: "completed", items: [] })) },
      navigation: { closeNavigation: vi.fn(), closeMobileDetails: vi.fn(), openMobileDetails: vi.fn(), pushActionSurface: vi.fn() },
      presentation: { clearListError: vi.fn(), reportListError: vi.fn(), setStatus: vi.fn(), getAccountName: () => "Alpha", toDisplayPath: (path: string) => path || "Home" },
      transfers: {
        enqueue: vi.fn(), beginPreparation: vi.fn(), beginTransfer: vi.fn(), reportProgress: vi.fn(), reportFailure: vi.fn(), complete: vi.fn(), completePartial: vi.fn(), fail: vi.fn(), failActiveTasks: vi.fn()
      } as never
    },
    runtime: runtime()
  } as unknown as OperationExecutionWorkspaceInput;
}

describe("operation execution workspace", () => {
  it("composes child owners and projects capabilities and Mutation Stage without exposing child command bags", () => {
    const { result } = renderHook((props: OperationExecutionWorkspaceInput) => useOperationExecutionWorkspace(props), { initialProps: input() });
    expect(result.current.authority.environment.mode).toBe("online");
    expect(result.current.capabilities.canCreateFolder).toBe(true);
    expect(result.current.capabilities.canDownloadSelected).toBe(true);
    expect(result.current.mutation.stage.state).toBe(result.current.mutation.state);
    expect(result.current.mutation).not.toHaveProperty("commands");
    expect(result.current.commands).not.toHaveProperty("submitActionDialog");
    expect(result.current.upload).toBeDefined();
  });

  it("uses the latest injected authority without constructing a second context", () => {
    const initial = input();
    const replacement = input({ accountId: "beta", token: "other" });
    const { result, rerender } = renderHook((props: OperationExecutionWorkspaceInput) => useOperationExecutionWorkspace(props), { initialProps: initial });
    expect(result.current.authority).toBe(initial.authority);
    rerender(replacement);
    expect(result.current.authority).toBe(replacement.authority);
  });
});
