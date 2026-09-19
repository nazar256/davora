import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../../policy";
import type { BatchArchiveInput } from "../../selection";
import type { UseDownloadInput } from "../useDownload";
import type { DownloadOrchestrationPorts } from "../orchestrationPorts";
import {
  useDownloadWorkspace,
  type UseDownloadWorkspaceInput
} from "./index";

const mocked = vi.hoisted(() => ({
  useDownload: vi.fn<(input: UseDownloadInput) => {
    downloadFocused(path: string, displayPath: string): Promise<void>;
    downloadBatch(): Promise<void>;
  }>()
}));

vi.mock("../useDownload", () => ({ useDownload: mocked.useDownload }));

function file(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").at(-1) ?? path, isFolder };
}

function createPorts(): DownloadOrchestrationPorts {
  return {
    registry: { acquire: vi.fn() },
    transfers: {
      createId: vi.fn(() => "transfer-1"),
      enqueue: vi.fn(),
      beginPreparation: vi.fn(),
      beginTransfer: vi.fn(),
      reportProgress: vi.fn(),
      reportFailure: vi.fn(),
      complete: vi.fn(),
      completePartial: vi.fn(),
      fail: vi.fn()
    },
    files: {
      prepareDownload: vi.fn(),
      fetchBlob: vi.fn(),
      listFiles: vi.fn(),
      triggerBrowserDownload: vi.fn()
    },
    batch: { downloadSelectionAsZip: vi.fn() },
    context: { isCurrent: vi.fn(() => true) },
    session: { terminateExpired: vi.fn(), terminateReconnectRequired: vi.fn() },
    errors: {
      isUnauthorized: vi.fn(() => false),
      isReconnectRequired: vi.fn(() => false),
      toErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback)
    },
    presentation: { reportStatus: vi.fn(), reportListError: vi.fn() }
  };
}

describe("useDownloadWorkspace contract", () => {
  it("captures current account/context and selection/archive snapshots for focused and batch commands", async () => {
    const operationContext = createOperationContextToken();
    const focused = file("Projects/roadmap.txt");
    const folder = file("Projects/Archive", true);
    const entries = [focused, folder];
    const archiveRoots = entries.map((entry) => ({ entry, archiveRoot: entry.path }));
    const archiveInput: BatchArchiveInput = {
      roots: archiveRoots,
      archiveLabel: "Projects"
    };
    const current = {
      accountId: "account-alpha",
      accountName: "Alpha workspace",
      token: "token-alpha",
      operationContextToken: operationContext,
      cacheOnlyMode: false,
      offline: false,
      hasSession: () => true
    };
    const selection = {
      entries,
      archiveInput
    };
    const workspaceInput = {
      current,
      selection,
      policy: {
        canOperate: () => true,
        canDownloadFocused: () => true,
        canDownloadBatch: () => true
      },
      resolveDisplayPath: (path: string) => `/${path}`,
      ports: createPorts()
    } satisfies UseDownloadWorkspaceInput;
    let childInput: UseDownloadInput | undefined;
    const childCommands = {
      downloadFocused: vi.fn(async () => undefined),
      downloadBatch: vi.fn(async () => undefined)
    };
    mocked.useDownload.mockImplementationOnce((input) => {
      childInput = input;
      return childCommands;
    });

    const { result } = renderHook(() => useDownloadWorkspace(workspaceInput));
    expect(childInput).toBeDefined();

    const captured = childInput!;
    const focusedInput = captured.buildFocusedInput("Projects/roadmap.txt", "/Projects/roadmap.txt");
    const batchInput = captured.buildBatchInput();
    expect(focusedInput).toMatchObject({ accountId: "account-alpha", context: operationContext });
    expect(batchInput).toMatchObject({ accountId: "account-alpha", accountName: "Alpha workspace", context: operationContext });
    expect(captured.getBatchEntries()).toEqual(entries);
    expect(captured.getBatchArchiveInput()).toEqual(archiveInput);

    current.accountId = "account-beta";
    current.accountName = "Beta workspace";
    current.token = "token-beta";
    entries.length = 0;
    archiveRoots.length = 0;

    expect(captured.buildFocusedInput("Projects/roadmap.txt", "/Projects/roadmap.txt")).toMatchObject({
      accountId: "account-alpha",
      context: operationContext
    });
    expect(captured.buildBatchInput()).toMatchObject({ accountId: "account-alpha", accountName: "Alpha workspace", context: operationContext });
    expect(captured.getBatchEntries()).toEqual([focused, folder]);
    expect(captured.getBatchArchiveInput()).toEqual({
      roots: [
        { entry: focused, archiveRoot: focused.path },
        { entry: folder, archiveRoot: folder.path }
      ],
      archiveLabel: "Projects"
    });

    await act(async () => {
      await result.current.commands.downloadFocused("Projects/roadmap.txt", "/Projects/roadmap.txt");
      await result.current.commands.downloadBatch();
    });
    expect(childCommands.downloadFocused).toHaveBeenCalledWith("Projects/roadmap.txt", "/Projects/roadmap.txt");
    expect(childCommands.downloadBatch).toHaveBeenCalledTimes(1);
  });
});
