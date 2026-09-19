import type { FormEvent } from "react";

import { ActionDialogStage } from "../actionDialog";
import { DestinationPickerStage } from "../destination";
import type { DestinationOperation } from "../destination";
import type { MutationWorkflowState } from "./model";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export interface MutationWorkflowStageProps {
  readonly state: MutationWorkflowState;
  readonly busy: boolean;
  readonly canCreateFolder: boolean;
  readonly canConfirmDelete: boolean;
  readonly canSubmitDestinationCopy: boolean;
  readonly canSubmitDestinationMove: boolean;
  readonly currentLocationLabel: string;
  readonly destinationValidationMessage?: string;
  readonly onActionValueChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onDestinationFolderChange: (path: string) => void;
  readonly onDestinationManualModeChange: (enabled: boolean) => void;
  readonly onDestinationManualPathChange: (path: string) => void;
  readonly onDestinationNameChange: (name: string) => void;
  readonly onDestinationReload: () => void;
  readonly onSubmitAction: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSubmitDestination: (operation: DestinationOperation, event?: FormEvent<HTMLFormElement>) => void;
}

export function MutationWorkflowStage(props: MutationWorkflowStageProps) {
  if (props.state.kind === "idle" || props.state.kind === "completed") {
    return null;
  }

  const error = props.state.presentationError;
  const { draft } = props.state;
  if (draft.kind === "action" && draft.dialog.kind === "createFolder") {
    return (
      <ActionDialogStage
        busy={props.busy || !props.canCreateFolder}
        description="Create a folder in this location."
        error={error}
        label="Folder name"
        onChange={props.onActionValueChange}
        onClose={props.onClose}
        onSubmit={props.onSubmitAction}
        open
        submitLabel="Create folder"
        supportingText={`Location: ${props.currentLocationLabel}`}
        title="Create folder"
        value={draft.dialog.value}
      />
    );
  }

  if (draft.kind === "destination" && draft.picker.sourceEntries.length > 0) {
    const picker = draft.picker;
    return (
      <DestinationPickerStage
        actionError={error}
        busy={props.busy}
        copyAllowed={props.canSubmitDestinationCopy}
        entries={picker.entries}
        error={picker.error}
        folderPath={picker.folderPath}
        kind={picker.kind}
        batch={picker.batch}
        loading={picker.loading}
        manualMode={picker.manualMode}
        manualPath={picker.manualPath}
        moveAllowed={props.canSubmitDestinationMove}
        name={picker.name}
        onClose={props.onClose}
        onFolderChange={props.onDestinationFolderChange}
        onManualModeChange={props.onDestinationManualModeChange}
        onManualPathChange={props.onDestinationManualPathChange}
        onNameChange={props.onDestinationNameChange}
        onReload={props.onDestinationReload}
        onSubmit={props.onSubmitDestination}
        open
        sourceEntries={picker.sourceEntries}
        validationMessage={props.destinationValidationMessage}
      />
    );
  }

  if (draft.kind === "action" && draft.dialog.kind === "delete"
    && draft.dialog.workflow.unresolvedTargets.length > 0) {
    const targets = draft.dialog.workflow.unresolvedTargets;
    return (
      <ActionDialogStage
        busy={props.busy || !props.canConfirmDelete}
        danger
        description={targets.length === 1
          ? "This permanently deletes the selected item from the server."
          : "This permanently deletes the selected items from the server."}
        error={error}
        onClose={props.onClose}
        onSubmit={props.onSubmitAction}
        open
        submitLabel="Delete"
        targetText={targets.length === 1
          ? targets[0]?.path || targets[0]?.confirmName
          : targets.map((target) => target.path || target.confirmName).join("\n")}
        title={targets.length === 1 ? "Delete item" : `Delete ${pluralize(targets.length, "item")}`}
      />
    );
  }

  return null;
}
