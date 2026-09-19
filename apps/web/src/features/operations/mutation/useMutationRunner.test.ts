import type { FileEntry, MutationResult } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import {
  buildOfflineMutationBlockedMessage,
  buildServerUnavailableMutationBlockedMessage,
  MUTATION_NO_SESSION_MESSAGE
} from "./model";
import type { MutationRunnerPorts } from "./ports";
import { useMutationRunner } from "./useMutationRunner";

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function mutationResult(path: string): MutationResult {
  return { action: "delete", parentPath: "", path };
}

function createPorts(overrides: Partial<MutationRunnerPorts> = {}): MutationRunnerPorts {
  return {
    session: {
      hasSession: vi.fn(() => true),
      isUnauthorized: vi.fn((error: unknown) => error instanceof ApiRequestError && error.status === 401),
      isReconnectRequired: vi.fn((error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required"),
      resetExpired: vi.fn(),
      resetReconnectRequired: vi.fn()
    },
    environment: {
      isCacheOnlyBlocked: vi.fn(() => false),
      isOffline: vi.fn(() => false)
    },
    context: {
      getOperationContextToken: vi.fn(() => createOperationContextToken()),
      isContextAllowed: vi.fn(() => true)
    },
    folder: {
      getCurrentPath: vi.fn(() => ""),
      navigateToPath: vi.fn(),
      refreshFolder: vi.fn(async () => undefined)
    },
    selection: {
      currentFocusedSelection: vi.fn(() => undefined),
      captureFocusedSelection: vi.fn(() => undefined),
      isFocusedSelectionCurrent: vi.fn(() => true),
      getSelectedPreview: vi.fn(() => undefined),
      applySelectionSync: vi.fn()
    },
    presentation: {
      clearListError: vi.fn(),
      setStatus: vi.fn(),
      getAccountName: vi.fn(() => "Workspace"),
      toDisplayPath: vi.fn((path: string) => path)
    },
    ...overrides
  };
}

describe("useMutationRunner", () => {
  it("throws when session is missing", async () => {
    const ports = createPorts({
      session: {
        hasSession: vi.fn(() => false),
        isUnauthorized: vi.fn(() => false),
        isReconnectRequired: vi.fn(() => false),
        resetExpired: vi.fn(),
        resetReconnectRequired: vi.fn()
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => mutationResult("notes.txt")))
        .rejects.toThrow(MUTATION_NO_SESSION_MESSAGE);
    });
  });

  it("throws the offline cache-only message", async () => {
    const ports = createPorts({
      environment: {
        isCacheOnlyBlocked: vi.fn(() => true),
        isOffline: vi.fn(() => true)
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => mutationResult("notes.txt")))
        .rejects.toThrow(buildOfflineMutationBlockedMessage());
    });
  });

  it("throws the server-unavailable cache-only message", async () => {
    const ports = createPorts({
      environment: {
        isCacheOnlyBlocked: vi.fn(() => true),
        isOffline: vi.fn(() => false)
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => mutationResult("notes.txt")))
        .rejects.toThrow(buildServerUnavailableMutationBlockedMessage());
    });
  });

  it("pairs begin and finish busy ownership for matching contexts only", () => {
    const context = createOperationContextToken();
    const otherContext = createOperationContextToken();
    const ports = createPorts({
      context: {
        getOperationContextToken: vi.fn(() => context),
        isContextAllowed: vi.fn(() => true)
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: context,
      ports
    }));

    act(() => {
      result.current.beginMutation(context);
    });
    expect(result.current.mutationBusy).toBe(true);
    act(() => {
      result.current.finishMutation(otherContext);
    });
    expect(result.current.mutationBusy).toBe(true);
    act(() => {
      result.current.finishMutation(context);
    });
    expect(result.current.mutationBusy).toBe(false);
  });

  it("does not let an old same-context owner clear a replacement attempt's busy state", () => {
    const context = createOperationContextToken();
    const firstOwner = {};
    const replacementOwner = {};
    const { result } = renderHook(() => useMutationRunner({ operationContextToken: context, ports: createPorts() }));

    act(() => {
      result.current.beginMutation(context, firstOwner);
      result.current.beginMutation(context, replacementOwner);
      result.current.finishMutation(context, firstOwner);
    });
    expect(result.current.mutationBusy).toBe(true);
    act(() => result.current.finishMutation(context, replacementOwner));
    expect(result.current.mutationBusy).toBe(false);
  });

  it("suppresses every post-await effect when attempt ownership is lost", async () => {
    const ports = createPorts();
    let current = true;
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(), ports
    }));

    await act(async () => {
      await result.current.executeMutation(async () => {
        current = false;
        return mutationResult("notes.txt");
      }, { isAttemptCurrent: () => current });
    });
    expect(ports.selection.applySelectionSync).not.toHaveBeenCalled();
    expect(ports.folder.refreshFolder).not.toHaveBeenCalled();
    expect(ports.presentation.setStatus).not.toHaveBeenCalled();
  });

  it("does not publish status or reset a session after ownership is lost during async work", async () => {
    let current = true;
    const ports = createPorts({
      folder: {
        getCurrentPath: vi.fn(() => ""),
        navigateToPath: vi.fn(),
        refreshFolder: vi.fn(async () => { current = false; })
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(), ports
    }));
    await act(async () => {
      await result.current.executeMutation(async () => mutationResult("notes.txt"), {
        isAttemptCurrent: () => current
      });
    });
    expect(ports.presentation.setStatus).not.toHaveBeenCalled();

    current = true;
    await act(async () => {
      await expect(result.current.executeMutation(async () => {
        current = false;
        throw new ApiRequestError("Session expired", 401, "session_invalid");
      }, { isAttemptCurrent: () => current })).rejects.toThrow("Session expired");
    });
    expect(ports.session.resetExpired).not.toHaveBeenCalled();
  });

  it("makes a pending mutation fully inert on path change without clearing replacement busy ownership", async () => {
    const context = createOperationContextToken();
    const ports = createPorts();
    let resolve!: (value: MutationResult) => void;
    const pending = new Promise<MutationResult>((accept) => { resolve = accept; });
    let attemptCurrent = true;
    const firstOwner = {};
    const replacementOwner = {};
    const { result, rerender } = renderHook(
      ({ path }) => useMutationRunner({ operationContextToken: context, currentPath: path, ports }),
      { initialProps: { path: "" } }
    );
    let operation!: Promise<MutationResult>;
    act(() => {
      operation = result.current.executeMutation(() => pending, {
        context,
        intent: { kind: "delete", count: 1 },
        isAttemptCurrent: () => attemptCurrent,
        busyOwner: firstOwner
      });
    });
    expect(result.current.mutationBusy).toBe(true);

    attemptCurrent = false;
    rerender({ path: "Projects" });
    expect(result.current.mutationBusy).toBe(false);
    act(() => result.current.beginMutation(context, replacementOwner));
    resolve(mutationResult("notes.txt"));
    await act(async () => { await operation; });

    expect(ports.selection.applySelectionSync).not.toHaveBeenCalled();
    expect(ports.folder.refreshFolder).not.toHaveBeenCalled();
    expect(ports.presentation.setStatus).not.toHaveBeenCalled();
    expect(result.current.mutationBusy).toBe(true);
    act(() => result.current.finishMutation(context, replacementOwner));
  });

  it("returns superseded results without syncing, refreshing, or status", async () => {
    const context = createOperationContextToken();
    const ports = createPorts({
      context: {
        getOperationContextToken: vi.fn(() => context),
        isContextAllowed: vi.fn(() => false)
      }
    });
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: context,
      ports
    }));

    let value: MutationResult | undefined;
    await act(async () => {
      value = await result.current.executeMutation(
        async () => mutationResult("notes.txt"),
        { context, intent: { kind: "delete", count: 1 } }
      );
    });

    expect(value).toEqual(mutationResult("notes.txt"));
    expect(ports.selection.applySelectionSync).not.toHaveBeenCalled();
    expect(ports.folder.refreshFolder).not.toHaveBeenCalled();
    expect(ports.presentation.setStatus).not.toHaveBeenCalled();
  });

  it("syncs selection, refreshes, and reports success by default", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await result.current.executeMutation(async () => ({
        action: "upload",
        parentPath: "",
        path: "new.txt",
        item: entry("new.txt")
      }));
    });

    expect(ports.selection.applySelectionSync).toHaveBeenCalledWith({
      kind: "focus-item",
      item: entry("new.txt"),
      rebindFromPath: "new.txt"
    }, undefined);
    expect(ports.folder.refreshFolder).toHaveBeenCalledWith("");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith("upload completed for new.txt in Workspace");
  });

  it("resets expired and reconnect-required sessions before rethrowing", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => {
        throw new ApiRequestError("Session expired", 401, "session_invalid");
      })).rejects.toThrow("Session expired");
    });
    expect(ports.session.resetExpired).toHaveBeenCalledWith("Session expired. Create a fresh session for this account.");

    await act(async () => {
      await expect(result.current.executeMutation(async () => {
        throw new ApiRequestError("Reconnect required", 403, "account_reconnect_required");
      })).rejects.toThrow("Reconnect required");
    });
    expect(ports.session.resetReconnectRequired).toHaveBeenCalledWith(
      "This account needs to be reconnected before completing mutations."
    );
  });

  it("does not publish a terminal-session token sentinel through presentation", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => {
        throw new ApiRequestError("token-alpha", 401, "session_invalid");
      })).rejects.toThrow("token-alpha");
    });

    expect(ports.presentation.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("token-alpha"));
    expect(ports.presentation.clearListError).toHaveBeenCalled();
  });

  it("normalizes non-Error failures", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useMutationRunner({
      operationContextToken: createOperationContextToken(),
      ports
    }));

    await act(async () => {
      await expect(result.current.executeMutation(async () => {
        throw "boom";
      })).rejects.toThrow("Mutation failed.");
    });
  });
});
