import type { FileEntry } from "@davora/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { buildMovePickerInitialState } from "../copyMove";
import { useMutationWorkflowLifecycle } from "../mutation";
import { createOperationContextToken } from "../policy";
import type { DestinationPickerPorts } from "./ports";
import { useDestinationPicker } from "./useDestinationPicker";

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

function createPorts(): {
  ports: DestinationPickerPorts;
  listFiles: ReturnType<typeof vi.fn>;
  resetSession: ReturnType<typeof vi.fn>;
} {
  const listFiles = vi.fn(async () => ({ items: [entry("Archive/existing.txt")] }));
  const resetSession = vi.fn();
  return {
    ports: {
      listing: {
        listFiles,
        isUnauthorized: (error: unknown) => error instanceof ApiRequestError && error.status === 401,
        isReconnectRequired: (error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required"
      },
      session: { resetSession }
    },
    listFiles,
    resetSession
  };
}

function renderDestinationPicker(overrides: Partial<Parameters<typeof useDestinationPicker>[0]> = {}) {
  const context = createOperationContextToken();
  const { ports, listFiles, resetSession } = createPorts();
  const onClearActionError = vi.fn();
  const hook = renderHook(() => {
    const lifecycle = useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" });
    return useDestinationPicker({
      cacheOnlyMode: false,
      token: "session-token",
      operationContextToken: context,
      isCurrentOperationContext: (left, right) => left === right,
      ports,
      onClearActionError,
      destinationPicker: lifecycle.currentDestinationPicker,
      setDestinationPicker: lifecycle.setDestinationPicker,
      ...overrides
    });
  });
  return { ...hook, context, ports, listFiles, resetSession, onClearActionError };
}

describe("useDestinationPicker", () => {
  it("loads destination folders for a valid listing path and refetches on reloadKey changes", async () => {
    const { result, context, listFiles } = renderDestinationPicker();
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker(buildMovePickerInitialState(context, selected));
    });

    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledWith("Projects", "session-token");
      expect(result.current.currentDestinationPicker?.loading).toBe(false);
      expect(result.current.currentDestinationPicker?.entries).toEqual([entry("Archive/existing.txt")]);
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledTimes(2);
    });
  });

  it("short-circuits invalid listing paths without calling listFiles", async () => {
    const { result, context, listFiles } = renderDestinationPicker();
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker({
        ...buildMovePickerInitialState(context, selected),
        manualMode: true,
        manualPath: "Archive/bad%2fname.txt"
      });
    });

    await waitFor(() => {
      expect(listFiles).not.toHaveBeenCalled();
      expect(result.current.currentDestinationPicker).toMatchObject({
        entries: [],
        loading: false,
        error: undefined
      });
    });
  });

  it("does not publish stale listing results after supersede", async () => {
    const { result, context, listFiles } = renderDestinationPicker();
    let resolveFirst: ((value: { items: FileEntry[] }) => void) | undefined;
    listFiles
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ items: [entry("Archive/newer.txt")] });
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker(buildMovePickerInitialState(context, selected));
    });
    act(() => {
      result.current.updateFolder("Archive");
    });

    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveFirst?.({ items: [entry("Projects/stale.txt")] });
    });

    expect(result.current.currentDestinationPicker?.entries).toEqual([entry("Archive/newer.txt")]);
  });

  it("resets the session and closes on unauthorized listing failures", async () => {
    const { result, context, listFiles, resetSession } = renderDestinationPicker();
    listFiles.mockRejectedValueOnce(new ApiRequestError("Session expired", 401));
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker(buildMovePickerInitialState(context, selected));
    });

    await waitFor(() => {
      expect(resetSession).toHaveBeenCalledWith("Session expired. Create a fresh session for this account.");
      expect(result.current.currentDestinationPicker).toBeUndefined();
    });
  });

  it("resets reconnect-required sessions and closes the picker", async () => {
    const { result, context, listFiles, resetSession } = renderDestinationPicker();
    listFiles.mockRejectedValueOnce(new ApiRequestError("Reconnect required", 403, "account_reconnect_required"));
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker(buildMovePickerInitialState(context, selected));
    });

    await waitFor(() => {
      expect(resetSession).toHaveBeenCalledWith(
        "This account needs to be reconnected before choosing a destination.",
        true
      );
      expect(result.current.currentDestinationPicker).toBeUndefined();
    });
  });

  it("skips network listing when cache-only or token is missing", async () => {
    const context = createOperationContextToken();
    const { ports, listFiles } = createPorts();
    const initialProps: { cacheOnlyMode: boolean; token: string | undefined } = {
      cacheOnlyMode: true,
      token: "session-token"
    };
    const { result, rerender } = renderHook(({ cacheOnlyMode, token }) => {
      const lifecycle = useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" });
      return useDestinationPicker({
        cacheOnlyMode,
        token,
        operationContextToken: context,
        isCurrentOperationContext: (left, right) => left === right,
        ports,
        onClearActionError: vi.fn(),
        destinationPicker: lifecycle.currentDestinationPicker,
        setDestinationPicker: lifecycle.setDestinationPicker
      });
    }, { initialProps });
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker(buildMovePickerInitialState(context, selected));
    });

    await waitFor(() => {
      expect(listFiles).not.toHaveBeenCalled();
    });

    rerender({ cacheOnlyMode: false, token: undefined });
    await waitFor(() => {
      expect(listFiles).not.toHaveBeenCalled();
    });
  });

  it("preserves batch invariants when updating drafts", async () => {
    const { result, context } = renderDestinationPicker();
    const sources = [entry("Projects/a.txt"), entry("Projects/b.txt")];

    act(() => {
      result.current.setDestinationPicker({
        context,
        kind: "copyMove",
        sourceEntries: sources,
        batch: true,
        folderPath: "Archive",
        name: "",
        nameEdited: false,
        manualPath: "Archive",
        manualMode: false,
        entries: [],
        loading: true,
        reloadKey: 0
      });
    });

    act(() => {
      result.current.updateFolder("Shared");
      result.current.updateManualMode(true);
      result.current.updateManualPath("Shared/batch-target");
    });

    expect(result.current.currentDestinationPicker).toMatchObject({
      batch: true,
      folderPath: "Shared",
      manualMode: true,
      manualPath: "Shared/batch-target",
      name: ""
    });
  });

  it("exposes unchanged planner validation outcomes", () => {
    const { result, context } = renderDestinationPicker();
    const selected = entry("Projects/report.txt");

    act(() => {
      result.current.setDestinationPicker({
        ...buildMovePickerInitialState(context, selected),
        folderPath: "Archive",
        name: "report.txt",
        manualPath: "Archive/report.txt",
        entries: [],
        loading: false
      });
    });

    expect(result.current.getValidation("move").kind).toBe("valid");
    expect(result.current.getValidation("copy").kind).toBe("valid");
  });
});
