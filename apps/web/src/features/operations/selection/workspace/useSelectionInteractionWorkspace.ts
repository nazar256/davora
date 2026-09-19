import { useLayoutEffect, useMemo, useRef } from "react";

import { useSelectionInteraction } from "../useSelectionInteraction";
import type {
  SelectionInteractionWorkspaceInput,
  SelectionInteractionWorkspaceOutput
} from "./ports";

export function useSelectionInteractionWorkspace(
  input: SelectionInteractionWorkspaceInput
): SelectionInteractionWorkspaceOutput {
  const committedEpochRef = useRef(input.epoch);
  useLayoutEffect(() => {
    committedEpochRef.current = input.epoch;
  }, [input.epoch]);

  const interaction = useSelectionInteraction({
    ports: useMemo(() => ({
      timer: input.ports.timer,
      chrome: input.ports.chrome,
      focused: input.selection.focused,
      batch: input.selection.batch,
      scope: {
        isSearchActive: input.environment.isSearchActive,
        getCurrentPath: input.environment.getCurrentPath
      }
    }), [input.environment.getCurrentPath, input.environment.isSearchActive, input.ports.chrome, input.ports.timer, input.selection.batch, input.selection.focused]),
    isCurrentOperationHandler: input.environment.isCurrentOperationHandler,
    isMarkBatchAllowed: input.environment.isMarkBatchAllowed,
    canMarkForBatchDownload: input.environment.canMarkForBatchDownload,
    captureEpoch: () => input.epoch,
    isEpochCurrent: (epoch) => committedEpochRef.current === epoch
  });

  return {
    commands: interaction
  };
}
