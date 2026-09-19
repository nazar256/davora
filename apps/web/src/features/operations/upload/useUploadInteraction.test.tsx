import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runUploadOrchestration } from "./orchestration";
import type { UploadMutationResult } from "./orchestrationPorts";
import type { FilePreparationResult, FolderCreationResult, UploadRefreshResult } from "./ports";
import { createOperationContextToken } from "../policy";
import { useUploadInteraction, type UseUploadInteractionInput } from "./useUploadInteraction";

vi.mock("./orchestration", () => ({ runUploadOrchestration: vi.fn(async () => undefined) }));

const mockedRunUploadOrchestration = vi.mocked(runUploadOrchestration);

async function unusedCreateFolder(): Promise<FolderCreationResult> {
  return { kind: "created" };
}

async function unusedUploadFile(): Promise<UploadMutationResult> {
  return { kind: "sessionTerminated" };
}

async function unusedRefreshFolder(): Promise<UploadRefreshResult> {
  return { kind: "completed" };
}

async function unusedPrepareFile(): Promise<FilePreparationResult> {
  return { kind: "failed", message: "unused" };
}

const ports: UseUploadInteractionInput["ports"] = {
  registry: { acquire: vi.fn(() => undefined) },
  transfers: {
    createId: vi.fn(() => "upload-id"),
    enqueue: vi.fn(),
    beginPreparation: vi.fn(),
    reportPreparationProgress: vi.fn(),
    beginTransfer: vi.fn(),
    reportUploadProgress: vi.fn(),
    complete: vi.fn(),
    failActive: vi.fn()
  },
  mutations: {
    begin: vi.fn(),
    finish: vi.fn(),
    createFolder: vi.fn(unusedCreateFolder),
    uploadFile: vi.fn(unusedUploadFile),
    refreshFolder: vi.fn(unusedRefreshFolder)
  },
  selection: { syncWithMutation: vi.fn() },
  presentation: {
    reportPlanError: vi.fn(),
    reportSuccess: vi.fn(),
    reportFailure: vi.fn(),
    reportUnexpectedError: vi.fn(),
    shouldReportUnexpectedError: vi.fn(() => true)
  },
  files: { prepare: vi.fn(unusedPrepareFile) }
};

function input(canDrop: () => boolean): UseUploadInteractionInput {
  return {
    dropAllowed: canDrop(),
    canUpload: canDrop,
    canDrop,
    buildOrchestrationInput: (files, source) => ({
      files,
      source,
      basePath: "",
      locationLabel: "/",
      accountId: "alpha",
      context: createOperationContextToken()
    }),
    ports
  };
}

describe("useUploadInteraction", () => {
  beforeEach(() => mockedRunUploadOrchestration.mockClear());

  it("prevents eligible file drags, uses copy, and keeps internal leaves active", () => {
    const { result } = renderHook(() => useUploadInteraction(input(() => true)));
    const zone = document.createElement("section");
    const child = document.createElement("span");
    zone.appendChild(child);
    const preventDefault = vi.fn();
    const dataTransfer = { types: ["Files"], files: [], dropEffect: "none" };

    act(() => result.current.drop.onDragEnter({ dataTransfer, preventDefault, currentTarget: zone }));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.drop.active).toBe(true);

    act(() => result.current.drop.onDragOver({ dataTransfer, preventDefault, currentTarget: zone }));
    expect(dataTransfer.dropEffect).toBe("copy");
    act(() => result.current.drop.onDragLeave({ currentTarget: zone, relatedTarget: child }));
    expect(result.current.drop.active).toBe(true);
  });

  it("uses the latest capability and uploads dropped files once in browser order", async () => {
    let allowed = false;
    const { result, rerender } = renderHook(() => useUploadInteraction(input(() => allowed)));
    const first = new File(["first"], "first.txt");
    const second = new File(["second"], "second.txt");
    const preventDefault = vi.fn();
    const event = {
      dataTransfer: { types: ["Files"], files: [first, second], dropEffect: "none" },
      preventDefault,
      currentTarget: document.createElement("section")
    };

    act(() => result.current.drop.onDragEnter(event));
    expect(preventDefault).not.toHaveBeenCalled();
    allowed = true;
    rerender();
    act(() => result.current.drop.onDrop(event));
    await act(async () => undefined);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockedRunUploadOrchestration).toHaveBeenCalledTimes(1);
    expect(mockedRunUploadOrchestration.mock.calls[0]?.[0].files).toEqual([first, second]);
    expect(mockedRunUploadOrchestration.mock.calls[0]?.[0].source).toBe("drop");
    expect(result.current.drop.active).toBe(false);
  });

  it("clears an active drag when a committed render becomes ineligible", () => {
    let allowed = true;
    const { result, rerender } = renderHook(() => useUploadInteraction(input(() => allowed)));
    const file = new File(["first"], "first.txt");
    const zone = document.createElement("section");
    const enterPreventDefault = vi.fn();

    act(() => result.current.drop.onDragEnter({
      dataTransfer: { types: ["Files"], files: [file], dropEffect: "none" },
      preventDefault: enterPreventDefault,
      currentTarget: zone
    }));
    expect(result.current.drop.active).toBe(true);

    allowed = false;
    rerender();
    expect(result.current.drop.active).toBe(false);

    const dropPreventDefault = vi.fn();
    act(() => result.current.drop.onDrop({
      dataTransfer: { types: ["Files"], files: [file], dropEffect: "none" },
      preventDefault: dropPreventDefault,
      currentTarget: zone
    }));
    expect(result.current.drop.active).toBe(false);
    expect(dropPreventDefault).not.toHaveBeenCalled();
    expect(mockedRunUploadOrchestration).not.toHaveBeenCalled();
  });

  it("does not prevent or upload ineligible text drops", () => {
    const { result } = renderHook(() => useUploadInteraction(input(() => true)));
    const preventDefault = vi.fn();
    act(() => result.current.drop.onDrop({
      dataTransfer: { types: ["text/plain"], files: [], dropEffect: "none" },
      preventDefault,
      currentTarget: document.createElement("section")
    }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockedRunUploadOrchestration).not.toHaveBeenCalled();
  });
});
