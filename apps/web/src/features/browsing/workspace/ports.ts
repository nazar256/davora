import type { FileEntry, SearchResult } from "@davora/shared";

import type { FolderMode } from "../folder/controller";
import type { FolderPorts } from "../folder/ports";
import type { SearchPorts } from "../search/ports";
import type { SortMode } from "../model";

export interface BrowsingWorkspaceContext {
  readonly accountId?: string;
  readonly accountName: string;
  readonly cacheNamespace?: string;
  readonly path: string;
  readonly token?: string;
}

export interface BrowsingWorkspaceMode {
  readonly folder: FolderMode;
  readonly search: "online" | "explicit-offline";
  readonly cacheOnly: boolean;
  readonly explicitOffline: boolean;
  readonly browserOffline: boolean;
}

export interface BrowsingWorkspaceSettings {
  readonly showHiddenFiles: boolean;
  readonly sortMode: SortMode;
}

export interface BrowsingWorkspaceOfflineSource {
  readonly folderItems: readonly FileEntry[];
  searchItemsFor(query: string): readonly SearchResult[];
}

export interface BrowsingWorkspaceSessionPorts {
  terminate(scope: "folder" | "search", reason: "unauthorized" | "reconnect-required"): void;
}

export interface BrowsingWorkspaceAvailabilityPorts {
  setWorkerUnavailable(unavailable: boolean): void;
}

export interface BrowsingWorkspacePresentationPorts {
  setStatus(message: string): void;
}

export interface BrowsingWorkspacePorts {
  readonly folder: FolderPorts;
  readonly search: SearchPorts;
  readonly session: BrowsingWorkspaceSessionPorts;
  readonly availability: BrowsingWorkspaceAvailabilityPorts;
  readonly presentation: BrowsingWorkspacePresentationPorts;
}

export interface BrowsingApplicationWorkspaceInput {
  readonly context: BrowsingWorkspaceContext;
  readonly mode: {
    readonly cacheOnly: boolean;
    readonly explicitOffline: boolean;
    readonly browserOffline: boolean;
    readonly workerUnavailable: boolean;
  };
  readonly settings: BrowsingWorkspaceSettings;
  readonly offlineSource: BrowsingWorkspaceOfflineSource;
  readonly ports: {
    readonly folder: FolderPorts;
    readonly search: SearchPorts;
    readonly session: { resetActiveSession(message: string, reconnectRequired: boolean): void };
    readonly availability: BrowsingWorkspaceAvailabilityPorts;
    readonly presentation: BrowsingWorkspacePresentationPorts;
    readonly navigation: {
      getCurrentPath(): string;
      setCurrentPath(path: string): void;
    };
  };
}

export interface BrowsingWorkspaceInput {
  readonly context: BrowsingWorkspaceContext;
  readonly mode: BrowsingWorkspaceMode;
  readonly settings: BrowsingWorkspaceSettings;
  readonly offlineSource: BrowsingWorkspaceOfflineSource;
  readonly ports: BrowsingWorkspacePorts;
}
