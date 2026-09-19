import type { FileEntry, MutationResult } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import { createBatchDeleteWorkflow } from "./model";
import type { ActionDialogOrchestrationPorts, ActionDialogOpenerPorts, ActionDialogPorts } from "./orchestrationPorts";
import { useActionDialog, type UseActionDialogInput } from "./useActionDialog";
import { issueMutationAttemptToken } from "../mutation/attempt";

function workflow(context: ReturnType<typeof createOperationContextToken>, hasSurface = false) {
  const attempt = issueMutationAttemptToken({ workflowIdentity: 1, context, path: "", pathGeneration: 0,
    ownershipGeneration: 0, mountGeneration: 1, domainIdentity: "test", intent: { kind: "createFolder" } });
  return { hasSurface: () => hasSurface, beginAttempt: vi.fn(() => attempt), isAttemptCurrent: vi.fn(() => true),
    failAttempt: vi.fn(), reportDeletePartial: vi.fn(), completeActionDialog: vi.fn(() => true) };
}

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function mutationResult(path: string): MutationResult {
  return { action: "delete", parentPath: "", path };
}

function createPorts(): ActionDialogPorts {
  const opener: ActionDialogOpenerPorts = {
    closeNavigation: vi.fn(),
    closeMobileDetails: vi.fn(),
    setActionError: vi.fn(),
    pushActionSurface: vi.fn(),
      showMobileActions: vi.fn(),
    openActionDialog: vi.fn()
  };
  const submit: ActionDialogOrchestrationPorts = {
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
      execute: vi.fn(async (runner: () => Promise<MutationResult>) => runner())
    },
    api: {
      createFolder: vi.fn(async () => mutationResult("Plans")),
      deleteFile: vi.fn(async () => mutationResult("notes.txt"))
    },
    batch: {
      executeDeleteTarget: vi.fn(async () => ({ kind: "completed" } as const)),
      acceptDeleteProgress: vi.fn(() => true),
      refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
      isDeleteWorkflowCurrent: vi.fn(() => true)
    },
    selection: {
      clear: vi.fn()
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

describe("useActionDialog", () => {
  it("opens create-folder and delete dialogs through opener ports", () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    const { result } = renderHook(() => useActionDialog({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => undefined,
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [selected, entry("notes.txt")],
      getCurrentPath: () => "",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    }));

    act(() => {
      result.current.openCreateFolder();
      result.current.openDelete();
      result.current.openDeleteSelection();
    });

    expect(ports.opener.openActionDialog).toHaveBeenCalledTimes(3);
    expect(ports.opener.pushActionSurface).toHaveBeenCalledTimes(3);
    expect(ports.opener.closeNavigation).toHaveBeenCalledTimes(1);
    expect(ports.opener.showMobileActions).toHaveBeenCalledTimes(1);
  });

  it("blocks submit when session guards fail", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const { result } = renderHook(() => useActionDialog({
      isCurrentOperationHandler: () => true,
      hasSession: () => false,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => ({ kind: "createFolder", value: "Plans", context }),
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    }));

    await act(async () => {
      await result.current.submitActionDialog();
    });

    expect(ports.submit.mutation.execute).not.toHaveBeenCalled();
  });

  it("replaces an existing mutation surface without adding another history entry", () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const { result } = renderHook(() => useActionDialog({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => undefined,
      currentFocusedSelection: () => entry("notes.txt"),
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "",
      getAccountName: () => "Workspace",
      workflow: workflow(context, true),
      ports
    }));

    act(() => result.current.openDelete());

    expect(ports.opener.openActionDialog).toHaveBeenCalledTimes(1);
    expect(ports.opener.pushActionSurface).not.toHaveBeenCalled();
  });

  it("submits create-folder when dialog is current", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const dialog = { kind: "createFolder" as const, value: "Plans", context };
    const lifecycle = workflow(context);
    const { result } = renderHook(() => useActionDialog({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => dialog,
      currentFocusedSelection: () => undefined,
      getBatchSelectionEntries: () => [],
      getCurrentPath: () => "",
      getAccountName: () => "Workspace",
      workflow: lifecycle,
      ports
    }));

    await act(async () => {
      await result.current.submitActionDialog();
    });

    expect(ports.submit.mutation.execute).toHaveBeenCalledTimes(1);
    expect(ports.submit.api.createFolder).toHaveBeenCalledWith("", "Plans");
    expect(lifecycle.beginAttempt).toHaveBeenCalledWith({ kind: "createFolder" });
    expect(lifecycle.completeActionDialog).toHaveBeenCalled();
  });

  it("allocates unique delete workflow identities for batch openers", () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    const { result } = renderHook(() => useActionDialog({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => undefined,
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [selected, entry("notes.txt")],
      getCurrentPath: () => "",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    }));

    act(() => {
      result.current.openDelete();
      result.current.openDeleteSelection();
    });

    const deleteDialogs = vi.mocked(ports.opener.openActionDialog).mock.calls
      .map(([state]) => state)
      .filter((state) => state.kind === "delete");
    expect(deleteDialogs).toHaveLength(2);
    expect(deleteDialogs[0]?.workflow.id).not.toBe(deleteDialogs[1]?.workflow.id);
    expect(deleteDialogs[0]?.workflow).toEqual(createBatchDeleteWorkflow(1, [{ path: selected.path, confirmName: selected.name }]));
    expect(deleteDialogs[1]?.workflow.submittedTargets).toHaveLength(2);
  });

  it("uses the latest owner for retained batch commands and snapshots ordered targets", () => {
    const makeInput = (
      path: string,
      entries: readonly FileEntry[],
      ports: ActionDialogPorts,
      allowed = true,
      current = true
    ): UseActionDialogInput => {
      const context = createOperationContextToken();
      return {
        isCurrentOperationHandler: () => current,
        hasSession: () => true,
        isOperationAllowed: () => allowed && entries.length > 0,
        getOperationContextToken: () => context,
        isCurrentOperationContext: () => true,
        getCurrentActionDialog: () => undefined,
        currentFocusedSelection: () => undefined,
        getBatchSelectionEntries: () => entries,
        getCurrentPath: () => path,
        getAccountName: () => "Workspace",
        workflow: workflow(context),
        ports
      };
    };
    const alphaPorts = createPorts();
    let currentInput = makeInput("Alpha", [entry("Alpha/old.txt")], alphaPorts);
    const { result, rerender } = renderHook(() => useActionDialog(currentInput));
    const retained = result.current.openDeleteSelection;
    const betaEntries = [entry("Beta/b.txt"), entry("Beta/folder"), entry("Beta/z.txt")];
    const betaPorts = createPorts();
    currentInput = makeInput("Beta", betaEntries, betaPorts);
    rerender();

    act(() => retained());

    expect(alphaPorts.opener.openActionDialog).not.toHaveBeenCalled();
    const dialog = vi.mocked(betaPorts.opener.openActionDialog).mock.calls[0]?.[0];
    if (!dialog || dialog.kind !== "delete") throw new Error("Expected the current batch delete dialog to open");
    expect(dialog.workflow.submittedTargets).toEqual([
      { path: "Beta/b.txt", confirmName: "b.txt" },
      { path: "Beta/folder", confirmName: "folder" },
      { path: "Beta/z.txt", confirmName: "z.txt" }
    ]);
    expect(dialog.workflow.submittedTargets).not.toBe(dialog.workflow.unresolvedTargets);
    expect(dialog.workflow.submittedTargets[0]).toBe(dialog.workflow.unresolvedTargets[0]);
    betaEntries.reverse();
    expect(dialog.workflow.submittedTargets.map((target) => target.path)).toEqual(["Beta/b.txt", "Beta/folder", "Beta/z.txt"]);
    expect(betaPorts.opener.closeMobileDetails).toHaveBeenCalledTimes(1);
    expect(betaPorts.opener.showMobileActions).toHaveBeenCalledTimes(1);
    expect(betaPorts.opener.pushActionSurface).toHaveBeenCalledTimes(1);
  });

  it("uses the latest focused entry for a retained delete command", () => {
    const makeInput = (
      context: ReturnType<typeof createOperationContextToken>,
      selected: FileEntry,
      ports: ActionDialogPorts
    ): UseActionDialogInput => ({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
      getCurrentActionDialog: () => undefined,
      currentFocusedSelection: () => selected,
      getBatchSelectionEntries: () => [selected],
      getCurrentPath: () => "Projects",
      getAccountName: () => "Workspace",
      workflow: workflow(context),
      ports
    });
    const alphaPorts = createPorts();
    let currentInput = makeInput(createOperationContextToken(), entry("Alpha/old.txt"), alphaPorts);
    const { result, rerender } = renderHook(() => useActionDialog(currentInput));
    const retained = result.current.openDelete;
    const betaContext = createOperationContextToken();
    const betaSelected = entry("Beta/current.txt");
    const betaPorts = createPorts();
    currentInput = makeInput(betaContext, betaSelected, betaPorts);
    rerender();

    act(() => retained());

    expect(alphaPorts.opener.openActionDialog).not.toHaveBeenCalled();
    const dialog = vi.mocked(betaPorts.opener.openActionDialog).mock.calls[0]?.[0];
    if (!dialog || dialog.kind !== "delete") throw new Error("Expected the current focused delete dialog to open");
    expect(dialog.context).toBe(betaContext);
    expect(dialog.workflow.submittedTargets).toEqual([{ path: "Beta/current.txt", confirmName: "current.txt" }]);
  });

  it("keeps empty, denied, and stale batch owners inert and stops later effects after an opener error", () => {
    const makeInput = (
      entries: readonly FileEntry[],
      ports: ActionDialogPorts,
      allowed = true,
      current = true
    ): UseActionDialogInput => {
      const context = createOperationContextToken();
      return {
        isCurrentOperationHandler: () => current,
        hasSession: () => true,
        isOperationAllowed: () => allowed && entries.length > 0,
        getOperationContextToken: () => context,
        isCurrentOperationContext: () => true,
        getCurrentActionDialog: () => undefined,
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
      const { result, unmount } = renderHook(() => useActionDialog(makeInput(entries, ports, allowed, current)));
      act(() => result.current.openDeleteSelection());
      expect(ports.opener.closeMobileDetails).not.toHaveBeenCalled();
      expect(ports.opener.openActionDialog).not.toHaveBeenCalled();
      unmount();
    }

    const ports = createPorts();
    const sentinel = new Error("opener sentinel");
    ports.opener.closeMobileDetails = vi.fn(() => { throw sentinel; });
    const { result, unmount } = renderHook(() => useActionDialog(makeInput([entry("Projects/file.txt")], ports)));
    expect(() => result.current.openDeleteSelection()).toThrow(sentinel);
    expect(ports.opener.showMobileActions).not.toHaveBeenCalled();
    expect(ports.opener.setActionError).not.toHaveBeenCalled();
    expect(ports.opener.pushActionSurface).not.toHaveBeenCalled();
    expect(ports.opener.openActionDialog).not.toHaveBeenCalled();
    unmount();
  });
});
