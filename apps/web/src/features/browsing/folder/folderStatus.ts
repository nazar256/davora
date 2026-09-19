import { assertNever, toDisplayPath } from "@davora/shared";

import type { FolderState } from "./model";

export interface FolderStatusContext {
  readonly path: string;
  readonly accountName: string;
  readonly token?: string;
}

export interface FolderStatusPorts {
  setStatus(message: string): void;
  clearListError(): void;
}

export function applyFolderStatus(
  folderState: FolderState,
  context: FolderStatusContext,
  ports: FolderStatusPorts
): void {
  const displayPath = toDisplayPath(context.path);

  switch (folderState.kind) {
    case "idle":
      return;
    case "initialLoading":
      ports.clearListError();
      return;
    case "refreshing":
      ports.clearListError();
      ports.setStatus(`Showing cached folder for ${displayPath} in ${context.accountName} while checking for changes.`);
      return;
    case "ready":
      ports.clearListError();
      if (folderState.message === "silent") {
        return;
      }
      ports.setStatus(`${folderState.message === "refreshed" ? "Refreshed" : "Viewing"} ${displayPath} in ${context.accountName}`);
      return;
    case "stale":
      ports.clearListError();
      if (!context.token && context.path === "") {
        return;
      }
      ports.setStatus(folderState.reason === "offline"
        ? `Offline snapshot for ${displayPath} in ${context.accountName}`
        : folderState.reason === "server-unavailable"
          ? `Cached snapshot for ${displayPath} in ${context.accountName} while the local server is unavailable.`
          : `Still showing cached folder for ${displayPath} in ${context.accountName} because live refresh failed.`);
      return;
    case "offline":
      ports.clearListError();
      if (!context.token && context.path === "") {
        return;
      }
      ports.setStatus(`Offline files in ${displayPath} for ${context.accountName}.`);
      return;
    case "failed":
      if (folderState.reason !== "live-failure") {
        ports.setStatus(folderState.reason === "offline-cache-miss"
          ? `Offline and no cached folder is available for ${displayPath} in ${context.accountName}`
          : `Local server unavailable and no cached folder is available for ${displayPath} in ${context.accountName}`);
      }
      return;
    default:
      return assertNever(folderState, "folder state");
  }
}
