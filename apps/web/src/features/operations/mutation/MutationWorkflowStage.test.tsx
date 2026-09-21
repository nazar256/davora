import type { FileEntry } from "@davora/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCreateFolderActionDialogState, buildDeleteActionDialogState, createBatchDeleteWorkflow } from "../delete";
import { createOperationContextToken } from "../policy";
import { issueMutationAttemptToken } from "./attempt";
import { buildMovePickerInitialState } from "../copyMove";
import { initialMutationWorkflowState, mutationWorkflowReducer } from "./model";
import { MutationWorkflowStage, type MutationWorkflowStageProps } from "./MutationWorkflowStage";

afterEach(cleanup);

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function props(overrides: Partial<MutationWorkflowStageProps>): MutationWorkflowStageProps {
  return {
    state: initialMutationWorkflowState,
    busy: false,
    canCreateFolder: true,
    canConfirmDelete: true,
    canSubmitDestinationCopy: true,
    canSubmitDestinationMove: true,
    currentLocationLabel: "Root",
    onActionValueChange: vi.fn(),
    onClose: vi.fn(),
    onDestinationFolderChange: vi.fn(),
    onDestinationManualModeChange: vi.fn(),
    onDestinationManualPathChange: vi.fn(),
    onDestinationNameChange: vi.fn(),
    onDestinationReload: vi.fn(),
    onSubmitAction: vi.fn(),
    onSubmitDestination: vi.fn(),
    onConflictDecisionChange: vi.fn(),
    onConflictApplyToAll: vi.fn(),
    onConflictApplySizeRuleChange: vi.fn(),
    onConflictConfirm: vi.fn(),
    onConflictBack: vi.fn(),
    ...overrides
  };
}

describe("MutationWorkflowStage", () => {
  it("renders only the current create-folder draft and publishes intent", () => {
    const context = createOperationContextToken();
    const state = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open",
      identity: 1,
      draft: { kind: "action", dialog: buildCreateFolderActionDialogState(context) }
    });
    const onActionValueChange = vi.fn();
    render(<MutationWorkflowStage {...props({ state, onActionValueChange })} />);

    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Projects" } });
    expect(onActionValueChange).toHaveBeenCalledWith("Projects");
    expect(screen.queryByRole("dialog", { name: /destination/i })).not.toBeInTheDocument();
  });

  it("renders a destination draft as the only surface", () => {
    const context = createOperationContextToken();
    const state = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open",
      identity: 2,
      draft: { kind: "destination", picker: buildMovePickerInitialState(context, entry("Projects/report.txt")) }
    });
    render(<MutationWorkflowStage {...props({ state })} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Create folder")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete item")).not.toBeInTheDocument();
  });

  it("keeps unresolved delete targets visible after a failed lifecycle outcome", () => {
    const context = createOperationContextToken();
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open",
      identity: 3,
      draft: {
        kind: "action",
        dialog: buildDeleteActionDialogState(context, createBatchDeleteWorkflow(1, [
          { path: "Projects/report.txt", confirmName: "report.txt" }
        ]))
      }
    });
    const attempt = issueMutationAttemptToken({ workflowIdentity: 3, context, path: "", pathGeneration: 0,
      ownershipGeneration: 0, mountGeneration: 1, domainIdentity: "delete:1", intent: { kind: "delete", count: 1 } });
    const validating = mutationWorkflowReducer(opened, {
      kind: "validate", identity: 3, context, intent: { kind: "delete", count: 1 }, attempt
    });
    const running = mutationWorkflowReducer(validating, { kind: "run", identity: 3, context, attempt });
    const failed = mutationWorkflowReducer(running, {
      kind: "fail",
      identity: 3,
      context,
      attempt,
      error: "Delete failed."
    });
    render(<MutationWorkflowStage {...props({ state: failed })} />);

    expect(screen.getByText("Projects/report.txt")).toBeInTheDocument();
    expect(screen.getByText("Delete failed.")).toBeInTheDocument();
  });
});
