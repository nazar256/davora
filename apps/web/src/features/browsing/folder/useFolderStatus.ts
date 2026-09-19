import { useEffect } from "react";

import { applyFolderStatus, type FolderStatusPorts } from "./folderStatus";
import type { FolderState } from "./model";

export interface UseFolderStatusInput {
  readonly state: FolderState;
  readonly path: string;
  readonly accountName: string;
  readonly token?: string;
  readonly ports: FolderStatusPorts;
}

export function useFolderStatus(input: UseFolderStatusInput): void {
  const { state, path, accountName, token, ports } = input;

  useEffect(() => {
    applyFolderStatus(state, { path, accountName, token }, ports);
  }, [accountName, path, ports, state, token]);
}
