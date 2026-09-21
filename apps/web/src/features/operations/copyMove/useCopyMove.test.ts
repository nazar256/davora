import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { createOperationContextToken } from "../policy";
import type { DestinationPickerState } from "../destination";
import { buildDestinationConflictReview } from "../destination/conflicts";
import type { CopyMoveOrchestrationPorts, CopyMoveOpenerPorts, CopyMovePorts } from "./orchestrationPorts";
import { buildSingleCopyMovePickerInitialState, type CopyMovePickerSnapshot } from "./model";
import { useCopyMove, type UseCopyMoveInput } from "./useCopyMove";
import { issueMutationAttemptToken } from "../mutation/attempt";

function workflow(context: ReturnType<typeof createOperationContextToken>) {
  const attempt = issueMutationAttemptToken({ workflowIdentity: 1, context, path: "Archive", pathGeneration: 0,
    ownershipGeneration: 0, mountGeneration: 1, domainIdentity: "test", intent: { kind: "copy", count: 1 } });
  return { hasSurface: () => false, beginAttempt: vi.fn(() => attempt),
    completeDestination: vi.fn(() => true), failAttempt: vi.fn() };
}

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
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
    presentation: {
      setActionError: vi.fn(),
      setStatus: vi.fn()
    },
    labels: {
      toDisplayPath: (path: string) => `/${path}`
    },
    tasks: {
      enqueue: vi.fn(() => "task-1")
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
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
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
        entries: [],
        loading: false
      }),
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(ports.submit.tasks.enqueue).not.toHaveBeenCalled();
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
      getAccountId: () => "account-1",
          setDestinationPicker: vi.fn(),
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

    expect(latestPorts.submit.tasks.enqueue).not.toHaveBeenCalled();
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
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
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
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
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
      getAccountId: () => "account-1",
        setDestinationPicker: vi.fn(),
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

  function pickerSnapshot(
    context: ReturnType<typeof createOperationContextToken>,
    overrides: Partial<CopyMovePickerSnapshot> = {}
  ): CopyMovePickerSnapshot {
    return {
      context,
      kind: "copyMove",
      sourceEntries: [entry("notes.txt")],
      batch: false,
      folderPath: "Archive",
      name: "notes.txt",
      nameEdited: false,
      manualPath: "",
      manualMode: false,
      entries: [],
      loading: false,
      ...overrides
    };
  }

  function applyPickerUpdate(
    setDestinationPicker: Mock<Dispatch<SetStateAction<DestinationPickerState | undefined>>>,
    picker: CopyMovePickerSnapshot
  ): DestinationPickerState | undefined {
    const updater = setDestinationPicker.mock.calls.at(-1)?.[0];
    return typeof updater === "function"
      ? updater({ reloadKey: 0, ...picker })
      : undefined;
  }

  it("opens a conflict review instead of executing when the plan has conflicts", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const picker = pickerSnapshot(context, { entries: [entry("Archive/notes.txt")] });
    const setDestinationPicker = vi.fn();
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker,
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(ports.submit.tasks.enqueue).not.toHaveBeenCalled();
    const reviewed = applyPickerUpdate(setDestinationPicker, picker);
    expect(reviewed?.conflictReview?.operation).toBe("copy");
    expect(reviewed?.conflictReview?.items).toHaveLength(1);
    expect(reviewed?.conflictReview?.items[0]?.allowedDecisions).toEqual(["replace", "keepBoth", "skip"]);
  });

  it("ignores submit while the destination listing is still loading", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const picker = pickerSnapshot(context, { loading: true });
    const setDestinationPicker = vi.fn();
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker,
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(setDestinationPicker).not.toHaveBeenCalled();
    expect(ports.submit.tasks.enqueue).not.toHaveBeenCalled();
  });

  it("ignores submit while a conflict review is open", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const existing = entry("Archive/notes.txt");
    const plan = {
      kind: "valid" as const,
      destinationPath: "Archive",
      targets: [{ source: entry("notes.txt"), destinationPath: "Archive/notes.txt" }],
      conflicts: [{ source: entry("notes.txt"), existing, destinationPath: "Archive/notes.txt", isSelfCollision: false }]
    };
    const picker = pickerSnapshot(context, {
      entries: [existing],
      conflictReview: buildDestinationConflictReview(plan, "copy")
    });
    const setDestinationPicker = vi.fn();
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker,
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitDestinationPicker("copy");
    });

    expect(setDestinationPicker).not.toHaveBeenCalled();
    expect(ports.submit.tasks.enqueue).not.toHaveBeenCalled();
  });

  it("confirms a conflict review and enqueues the resolved replace with overwrite", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const flow = workflow(context);
    const source = { ...entry("notes.txt"), size: 100 };
    const existing = { ...entry("Archive/notes.txt"), size: 40 };
    const plan = {
      kind: "valid" as const,
      destinationPath: "Archive",
      targets: [{ source, destinationPath: "Archive/notes.txt" }],
      conflicts: [{ source, existing, destinationPath: "Archive/notes.txt", isSelfCollision: false }]
    };
    const picker = pickerSnapshot(context, {
      sourceEntries: [source],
      entries: [existing],
      conflictReview: buildDestinationConflictReview(plan, "copy")
    });
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
      workflow: flow,
      ports
    }));

    await act(async () => {
      await result.current.confirmConflictReview();
    });

    expect(ports.submit.tasks.enqueue).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(ports.submit.tasks.enqueue).mock.calls[0]?.[0];
    expect(spec).toMatchObject({
      operation: "copy",
      destinationPath: "Archive",
      accountId: "account-1",
      targets: [{ source, destinationPath: "Archive/notes.txt", mode: "overwrite" }],
      skipped: []
    });
    expect(flow.completeDestination).toHaveBeenCalledTimes(1);
  });

  it("enqueues a task that only carries skipped entries when every conflict is skipped", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const flow = workflow(context);
    const existing = entry("Archive/notes.txt");
    const plan = {
      kind: "valid" as const,
      destinationPath: "Archive",
      targets: [{ source: entry("notes.txt"), destinationPath: "Archive/notes.txt" }],
      conflicts: [{ source: entry("notes.txt"), existing, destinationPath: "Archive/notes.txt", isSelfCollision: false }]
    };
    const review = buildDestinationConflictReview(plan, "copy");
    const picker = pickerSnapshot(context, {
      entries: [existing],
      conflictReview: { ...review, applySizeRule: false }
    });
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
      workflow: flow,
      ports
    }));

    await act(async () => {
      await result.current.confirmConflictReview();
    });

    expect(ports.submit.tasks.enqueue).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(ports.submit.tasks.enqueue).mock.calls[0]?.[0];
    expect(spec?.targets).toEqual([]);
    expect(spec?.skipped.map((item) => item.path)).toEqual(["notes.txt"]);
    expect(flow.completeDestination).toHaveBeenCalledTimes(1);
  });

  it("enqueues a merge-mode task for a single folder conflict", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const flow = workflow(context);
    const source = { ...entry("Docs"), isFolder: true };
    const existing = { ...entry("Archive/Docs"), isFolder: true };
    const plan = {
      kind: "valid" as const,
      destinationPath: "Archive",
      targets: [{ source, destinationPath: "Archive/Docs" }],
      conflicts: [{ source, existing, destinationPath: "Archive/Docs", isSelfCollision: false }]
    };
    const review = {
      ...buildDestinationConflictReview(plan, "move"),
      items: buildDestinationConflictReview(plan, "move").items.map((item) => ({ ...item, decision: "merge" as const }))
    };
    const picker = pickerSnapshot(context, {
      kind: "move",
      sourceEntries: [source],
      entries: [existing],
      conflictReview: review
    });
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker: vi.fn(),
      workflow: flow,
      ports
    }));

    await act(async () => {
      await result.current.confirmConflictReview();
    });

    expect(ports.submit.tasks.enqueue).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(ports.submit.tasks.enqueue).mock.calls[0]?.[0];
    expect(spec).toMatchObject({
      operation: "move",
      destinationPath: "Archive",
      targets: [{ source, destinationPath: "Archive/Docs", mode: "merge" }]
    });
    expect(flow.completeDestination).toHaveBeenCalledTimes(1);
  });

  it("updates per-item decisions, bulk decisions, and the size rule on the open review", () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const existing = entry("Archive/notes.txt");
    const plan = {
      kind: "valid" as const,
      destinationPath: "Archive",
      targets: [{ source: entry("notes.txt"), destinationPath: "Archive/notes.txt" }],
      conflicts: [{ source: entry("notes.txt"), existing, destinationPath: "Archive/notes.txt", isSelfCollision: false }]
    };
    const picker = pickerSnapshot(context, {
      entries: [existing],
      conflictReview: buildDestinationConflictReview(plan, "copy")
    });
    const setDestinationPicker = vi.fn();
    const { result } = renderHook(() => useCopyMove({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentDestinationPicker: () => picker,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "Archive",
      getAccountName: () => "Workspace",
      getAccountId: () => "account-1",
      setDestinationPicker,
      workflow: workflow(context),
      ports
    }));

    act(() => result.current.updateConflictDecision("notes.txt", "keepBoth"));
    expect(applyPickerUpdate(setDestinationPicker, picker)?.conflictReview?.items[0]?.decision).toBe("keepBoth");

    act(() => result.current.applyConflictDecisionToAll("skip"));
    expect(applyPickerUpdate(setDestinationPicker, picker)?.conflictReview?.items[0]?.decision).toBe("skip");

    act(() => result.current.updateConflictApplySizeRule(false));
    expect(applyPickerUpdate(setDestinationPicker, picker)?.conflictReview?.applySizeRule).toBe(false);

    act(() => result.current.dismissConflictReview());
    expect(applyPickerUpdate(setDestinationPicker, picker)?.conflictReview).toBeUndefined();
  });
});
