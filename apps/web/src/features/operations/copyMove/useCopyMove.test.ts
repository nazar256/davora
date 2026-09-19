import type { FileEntry, MutationResult } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import type { CopyMoveOrchestrationPorts, CopyMoveOpenerPorts, CopyMovePorts } from "./orchestrationPorts";
import { buildSingleCopyMovePickerInitialState } from "./model";
import { useCopyMove, type UseCopyMoveInput } from "./useCopyMove";
import { issueMutationAttemptToken } from "../mutation/attempt";

function workflow(context: ReturnType<typeof createOperationContextToken>) {
  const attempt = issueMutationAttemptToken({ workflowIdentity: 1, context, path: "Archive", pathGeneration: 0,
    ownershipGeneration: 0, mountGeneration: 1, domainIdentity: "test", intent: { kind: "copy", count: 1 } });
  return { hasSurface: () => false, beginAttempt: vi.fn(() => attempt), isAttemptCurrent: vi.fn(() => true),
    failAttempt: vi.fn(), reportPartial: vi.fn(), completeDestination: vi.fn(() => true) };
}

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function mutationResult(path: string, destinationPath: string): MutationResult {
  return {
    action: "copy",
    parentPath: "",
    path,
    destinationPath
  };
}

function createPorts(): CopyMovePorts {
  const opener: CopyMoveOpenerPorts = {
    closeMobileDetails: vi.fn(),
    setActionError: vi.fn(),
    pushActionSurface: vi.fn(),
    showMobileActions: vi.fn(),
    openDestinationPicker: vi.fn()
  };
  const submit: CopyMoveOrchestrationPorts = {
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isContextAllowed: vi.fn(() => true)
    },
    session: {
      hasSession: vi.fn(() => true),
      isUnauthorized: vi.fn(() => false),
      isReconnectRequired: vi.fn(() => false)
    },
    mutations: {
      begin: vi.fn(),
      finish: vi.fn()
    },
    mutation: {
      execute: vi.fn(async () => mutationResult("notes.txt", "Archive/notes.txt"))
    },
    api: {
      runCopyOrMove: vi.fn(async () => mutationResult("notes.txt", "Archive/notes.txt"))
    },
    batch: {
      executeCopyMoveTarget: vi.fn(async () => ({ kind: "completed" } as const)),
      refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
    },
    selection: {
      retainFailedPaths: vi.fn(),
      clear: vi.fn()
    },
    destinationPicker: {
      closeIfCurrent: vi.fn()
    },
    presentation: {
      setActionError: vi.fn(),
      setStatus: vi.fn(),
      closeMobileDetails: vi.fn(),
      clearFocused: vi.fn()
    },
    labels: {
      toDisplayPath: (path: string) => `/${path}`
    }
  };
  return { opener, submit };
}

describe("useCopyMove", () => {
  it("opens move and copy/move pickers through opener ports", () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => undefined,
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [selected],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    }));

    act(() => {
      result.current.openMove();
      result.current.openCopyMove();
      result.current.openCopyMoveSelection();
    });

    expect(ports.opener.openDestinationPicker).toHaveBeenCalledTimes(3);
    expect(ports.opener.pushActionSurface).toHaveBeenCalledTimes(3);
    expect(ports.opener.showMobileActions).toHaveBeenCalledTimes(1);
  });

  it("blocks submit when session guards fail", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const selected = entry("notes.txt");
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => false,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => ({
        context,
        kind: "copyMove",
        sourceEntries: [selected],
        batch: false,
        folderPath: "Archive",
        name: "notes.txt",
        nameEdited: false,
        manualPath: "Archive/notes.txt",
        manualMode: false,
        entries: []
      }),
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(ports.submit.mutation.execute).not.toHaveBeenCalled();
  });

  it("does not submit an open picker after capability removal", async () => {
    const context = createOperationContextToken();
    const selected = entry("notes.txt");
    const picker = buildSingleCopyMovePickerInitialState(context, selected);
    let latestPorts = createPorts();
    const { result, rerender } = renderHook(
      ({ allowed }: { readonly allowed: boolean }) => {
        latestPorts = createPorts();
        latestPorts.submit.context.isContextAllowed = vi.fn(() => allowed);
        return useCopyMove({
          isCurrentOperationHandler: () => true,
          hasSession: () => true,
          isOperationAllowed: () => allowed,
          getOperationContextToken: () => context,
          isCurrentOperationContext: () => true,
          getCurrentDestinationPicker: () => picker,
          currentFocusedSelection: () => selected,
          getBatchSelectionEntries: () => [selected],
          getCurrentPath: () => "Archive",
          getAccountName: () => "Workspace",
          workflow: workflow(context),
          ports: latestPorts
        });
      },
      { initialProps: { allowed: true } }
    );
    rerender({ allowed: false });
    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(latestPorts.submit.mutation.execute).not.toHaveBeenCalled();
    expect(latestPorts.submit.api.runCopyOrMove).not.toHaveBeenCalled();
  });

  it("uses the latest owner for retained batch commands and snapshots ordered entries", () => {
    const makeInput = (
      context: ReturnType<typeof createOperationContextToken>,
      path: string,
      entries: readonly FileEntry[],
      ports: CopyMovePorts,
      allowed = true,
      current = true
    ): UseCopyMoveInput => ({
      isCurrentOperationHandler: () => current,
      hasSession: () => true,
      isOperationAllowed: () => allowed && entries.length > 0,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => undefined,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => entries,
      getCurrentPath: () => path,
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    });
    const alphaContext = createOperationContextToken();
    const alphaPorts = createPorts();
    let currentInput = makeInput(alphaContext, "Alpha", [entry("Alpha/old.txt")], alphaPorts);
    const { result, rerender } = renderHook(() => useCopyMove(currentInput));
    const retained = result.current.openCopyMoveSelection;
    const betaContext = createOperationContextToken();
    const betaEntries = [entry("Beta/b.txt"), entry("Beta/folder"), entry("Beta/z.txt")];
    const betaPorts = createPorts();
    currentInput = makeInput(betaContext, "Beta", betaEntries, betaPorts);
    rerender();

    act(() => retained());

    expect(alphaPorts.opener.openDestinationPicker).not.toHaveBeenCalled();
    const picker = vi.mocked(betaPorts.opener.openDestinationPicker).mock.calls[0]?.[0];
    if (!picker) throw new Error("Expected the current batch picker to open");
    expect(picker.context).toBe(betaContext);
    expect(picker.folderPath).toBe("Beta");
    expect(picker.sourceEntries).not.toBe(betaEntries);
    expect(picker.sourceEntries.map((item) => item.path)).toEqual(["Beta/b.txt", "Beta/folder", "Beta/z.txt"]);
    betaEntries.reverse();
    expect(picker.sourceEntries.map((item) => item.path)).toEqual(["Beta/b.txt", "Beta/folder", "Beta/z.txt"]);
    expect(betaPorts.opener.closeMobileDetails).toHaveBeenCalledTimes(1);
    expect(betaPorts.opener.showMobileActions).toHaveBeenCalledTimes(1);
    expect(betaPorts.opener.pushActionSurface).toHaveBeenCalledTimes(1);
  });

  it("uses the latest focused entry for retained move and copy commands", () => {
    const makeInput = (
      context: ReturnType<typeof createOperationContextToken>,
      selected: FileEntry,
      ports: CopyMovePorts
    ): UseCopyMoveInput => ({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => undefined,
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [selected],
      getCurrentPath: () => "Projects",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    });
    const alphaPorts = createPorts();
    let currentInput = makeInput(createOperationContextToken(), entry("Alpha/old.txt"), alphaPorts);
    const { result, rerender } = renderHook(() => useCopyMove(currentInput));
    const retainedMove = result.current.openMove;
    const retainedCopy = result.current.openCopyMove;
    const betaContext = createOperationContextToken();
    const betaSelected = entry("Beta/current.txt");
    const betaPorts = createPorts();
    currentInput = makeInput(betaContext, betaSelected, betaPorts);
    rerender();

    act(() => {
      retainedMove();
      retainedCopy();
    });

    expect(alphaPorts.opener.openDestinationPicker).not.toHaveBeenCalled();
    const opened = vi.mocked(betaPorts.opener.openDestinationPicker).mock.calls.map(([snapshot]) => snapshot);
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatchObject({ kind: "move", context: betaContext, sourceEntries: [betaSelected], batch: false });
    expect(opened[1]).toMatchObject({ kind: "copyMove", context: betaContext, sourceEntries: [betaSelected], batch: false });
  });

  it("keeps empty, denied, and stale batch owners inert and stops later effects after an opener error", () => {
    const makeInput = (
      entries: readonly FileEntry[],
      ports: CopyMovePorts,
      allowed = true,
      current = true
    ): UseCopyMoveInput => {
      const context = createOperationContextToken();
      return {
        isCurrentOperationHandler: () => current,
        hasSession: () => true,
        isOperationAllowed: () => allowed && entries.length > 0,
        getOperationContextToken: () => context,
        isCurrentOperationContext: () => true,
        getCurrentDestinationPicker: () => undefined,
        currentFocusedSelection: () => undefined,
        getBatchSelectionEntries: () => entries,
        getCurrentPath: () => "Projects",
        getAccountName: () => "Workspace",
        workflow: workflow(context),
        ports
      };
    };
    const cases: ReadonlyArray<{ readonly entries: readonly FileEntry[]; readonly allowed: boolean; readonly current: boolean }> = [
      { entries: [], allowed: true, current: true },
      { entries: [entry("Projects/denied.txt")], allowed: false, current: true },
      { entries: [entry("Projects/stale.txt")], allowed: true, current: false }
    ];
    for (const { entries, allowed, current } of cases) {
      const ports = createPorts();
      const { result, unmount } = renderHook(() => useCopyMove(makeInput(entries, ports, allowed, current)));
      act(() => result.current.openCopyMoveSelection());
      expect(ports.opener.closeMobileDetails).not.toHaveBeenCalled();
      expect(ports.opener.openDestinationPicker).not.toHaveBeenCalled();
      unmount();
    }

    const ports = createPorts();
    const sentinel = new Error("opener sentinel");
    ports.opener.closeMobileDetails = vi.fn(() => { throw sentinel; });
    const { result, unmount } = renderHook(() => useCopyMove(makeInput([entry("Projects/file.txt")], ports)));
    expect(() => result.current.openCopyMoveSelection()).toThrow(sentinel);
    expect(ports.opener.showMobileActions).not.toHaveBeenCalled();
    expect(ports.opener.setActionError).not.toHaveBeenCalled();
    expect(ports.opener.pushActionSurface).not.toHaveBeenCalled();
    expect(ports.opener.openDestinationPicker).not.toHaveBeenCalled();
    unmount();
  });
});
