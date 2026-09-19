import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { createOperationContextToken } from "../policy";
import {
  acceptDeleteProgress,
  buildCreateFolderActionDialogState,
  buildDeleteActionDialogState,
  createBatchDeleteWorkflow
} from "../delete";
import { buildMovePickerInitialState } from "../copyMove";
import { useMutationWorkflowLifecycle } from "./useMutationWorkflowLifecycle";

describe("useMutationWorkflowLifecycle", () => {
  it("replaces a surface and makes the old attempt inert in the same context", () => {
    const context = createOperationContextToken();
    const { result } = renderHook(() => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }));
    const first = buildCreateFolderActionDialogState(context, "First");
    act(() => result.current.setActionDialog(first));
    let oldAttempt: ReturnType<typeof result.current.beginAttempt>;
    act(() => { oldAttempt = result.current.beginAttempt({ kind: "createFolder" }); });
    expect(oldAttempt).toBeDefined();

    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(context, "Replacement")));
    expect(result.current.isAttemptCurrent(oldAttempt!)).toBe(false);
    act(() => {
      result.current.failAttempt(oldAttempt!, "stale");
      result.current.completeActionDialog(oldAttempt!, first);
    });
    expect(result.current.currentActionDialog).toMatchObject({ kind: "createFolder", value: "Replacement" });
  });

  it("invalidates an attempt on path change without replacing the operation context", () => {
    const context = createOperationContextToken();
    const { result, rerender } = renderHook(
      ({ path }) => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: path }),
      { initialProps: { path: "" } }
    );
    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "createFolder" }); });
    rerender({ path: "Projects" });
    expect(result.current.state).toEqual({ kind: "idle" });
    expect(result.current.isAttemptCurrent(owner!)).toBe(false);
  });

  it("invalidates attempts across context changes and unmount", () => {
    const first = createOperationContextToken();
    const second = createOperationContextToken();
    const { result, rerender, unmount } = renderHook(
      ({ context }) => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }),
      { initialProps: { context: first } }
    );
    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(first)));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "createFolder" }); });
    rerender({ context: second });
    expect(result.current.isAttemptCurrent(owner!)).toBe(false);
    unmount();
    expect(result.current.isAttemptCurrent(owner!)).toBe(false);
  });

  it("invalidates on direct dismissal and on a real unmount without a prior context change", () => {
    const context = createOperationContextToken();
    const first = renderHook(() => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }));
    act(() => first.result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let dismissed: ReturnType<typeof first.result.current.beginAttempt>;
    act(() => { dismissed = first.result.current.beginAttempt({ kind: "createFolder" }); });
    act(() => first.result.current.dismissCurrent());
    expect(first.result.current.isAttemptCurrent(dismissed!)).toBe(false);

    act(() => first.result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let unmounted: ReturnType<typeof first.result.current.beginAttempt>;
    act(() => { unmounted = first.result.current.beginAttempt({ kind: "createFolder" }); });
    first.unmount();
    expect(first.result.current.isAttemptCurrent(unmounted!)).toBe(false);
  });

  it("keeps a post-replay StrictMode attempt current until its owner is dismissed", () => {
    const context = createOperationContextToken();
    const { result } = renderHook(
      () => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }),
      { wrapper: StrictMode }
    );
    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "createFolder" }); });
    expect(result.current.isAttemptCurrent(owner!)).toBe(true);
    act(() => result.current.dismissCurrent());
    expect(result.current.isAttemptCurrent(owner!)).toBe(false);
  });

  it("keeps deferred workflow callbacks inert after StrictMode owner unmount", () => {
    const context = createOperationContextToken();
    const { result, unmount } = renderHook(
      () => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }),
      { wrapper: StrictMode }
    );
    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "createFolder" }); });

    unmount();
    act(() => { result.current.failAttempt(owner!, "late failure"); });
    expect(result.current.isAttemptCurrent(owner!)).toBe(false);
  });

  it("rejects stale destination partial and completion outcomes", () => {
    const context = createOperationContextToken();
    const source = { path: "notes.txt", name: "notes.txt", isFolder: false };
    const { result } = renderHook(() => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }));
    act(() => result.current.setDestinationPicker(buildMovePickerInitialState(context, source)));
    let stale: ReturnType<typeof result.current.beginAttempt>;
    act(() => { stale = result.current.beginAttempt({ kind: "move", count: 1 }); });
    act(() => result.current.setDestinationPicker(buildMovePickerInitialState(context, source)));
    act(() => {
      result.current.reportPartial(stale!, "stale partial", [source]);
      void result.current.completeDestination(stale!, context);
    });
    expect(result.current.state.kind).toBe("choosingDestination");
    expect(result.current.state.kind === "choosingDestination" ? result.current.state.presentationError : undefined).toBeUndefined();
  });

  it("rejects illegal intent and draft pairs", () => {
    const context = createOperationContextToken();
    const { result } = renderHook(() => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "" }));
    act(() => result.current.setActionDialog(buildCreateFolderActionDialogState(context)));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "delete", count: 1 }); });
    expect(owner).toBeUndefined();
    expect(result.current.state.kind).toBe("collectingInput");
  });

  it("accepts only token-owned delete progress and completion", () => {
    const context = createOperationContextToken();
    const first = { path: "Projects/a.txt", confirmName: "a.txt" };
    const second = { path: "Projects/b.txt", confirmName: "b.txt" };
    const workflow = createBatchDeleteWorkflow(9, [first, second]);
    const dialog = buildDeleteActionDialogState(context, workflow);
    const { result } = renderHook(() => useMutationWorkflowLifecycle({ operationContextToken: context, currentPath: "Projects" }));
    act(() => result.current.setActionDialog(dialog));
    let owner: ReturnType<typeof result.current.beginAttempt>;
    act(() => { owner = result.current.beginAttempt({ kind: "delete", count: 2 }); });
    const next = acceptDeleteProgress(workflow, first);
    act(() => { void result.current.updateDeleteWorkflow(owner!, next); });
    expect(result.current.currentActionDialog).toMatchObject({ workflow: { unresolvedTargets: [second] } });
    act(() => result.current.reportDeletePartial(owner!, {
      workflow: next, failedTarget: second, completedCount: 1, totalCount: 2, error: "second failed"
    }));
    expect(result.current.state).toMatchObject({
      kind: "partial",
      partial: { kind: "delete", completedCount: 1, totalCount: 2, unresolvedTargets: [second], failedTarget: second }
    });
    act(() => result.current.setPresentationError(undefined));
    let retry: ReturnType<typeof result.current.beginAttempt>;
    act(() => { retry = result.current.beginAttempt({ kind: "delete", count: 1 }); });
    expect(retry).toBeDefined();
    expect(result.current.currentActionDialog).toMatchObject({ workflow: { unresolvedTargets: [second] } });
  });
});
