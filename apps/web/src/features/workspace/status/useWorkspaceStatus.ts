import { useCallback, useMemo, useState } from "react";

import {
  announceWorkspaceStatus,
  createWorkspaceStatusSnapshot,
  type WorkspaceStatusCommands,
  type WorkspaceStatusSnapshot
} from "./model";

export interface WorkspaceStatusInput {
  readonly initialMessage: string;
}

export interface WorkspaceStatusOutput {
  readonly snapshot: WorkspaceStatusSnapshot;
  readonly commands: WorkspaceStatusCommands;
}

export function useWorkspaceStatus(input: WorkspaceStatusInput): WorkspaceStatusOutput {
  const [snapshot, setSnapshot] = useState<WorkspaceStatusSnapshot>(() =>
    createWorkspaceStatusSnapshot(input.initialMessage)
  );
  const announce = useCallback((message: string) => {
    setSnapshot((previous) => announceWorkspaceStatus(previous, message));
  }, []);
  const commands = useMemo<WorkspaceStatusCommands>(() => ({ announce }), [announce]);

  return useMemo(() => ({ snapshot, commands }), [commands, snapshot]);
}
