import { useMemo, useRef } from "react";

import type { BrowsingApplicationWorkspaceInput, BrowsingWorkspacePorts } from "./ports";
import { useBrowsingWorkspace, type BrowsingWorkspaceOutput } from "./useBrowsingWorkspace";
import { useFolderLoadCoordination, type FolderLoadCoordination } from "./useFolderLoadCoordination";

export interface BrowsingApplicationWorkspace {
  readonly workspace: BrowsingWorkspaceOutput;
  readonly load: FolderLoadCoordination;
}

export function useBrowsingApplicationWorkspace(input: BrowsingApplicationWorkspaceInput): BrowsingApplicationWorkspace {
  const portsRef = useRef(input.ports);
  portsRef.current = input.ports;
  const workspacePorts = useMemo((): BrowsingWorkspacePorts => ({
    folder: {
      createAbortHandle: () => portsRef.current.folder.createAbortHandle(),
      loadFolder: (request) => portsRef.current.folder.loadFolder(request),
      readCachedFolder: (cacheNamespace, path) => portsRef.current.folder.readCachedFolder(cacheNamespace, path),
      writeCachedFolder: (cacheNamespace, path, items, completeness) => portsRef.current.folder.writeCachedFolder(cacheNamespace, path, items, completeness)
    },
    search: {
      createAbortHandle: () => portsRef.current.search.createAbortHandle(),
      loadSearch: (request) => portsRef.current.search.loadSearch(request),
      readCachedSearch: (cacheNamespace, path, query) => portsRef.current.search.readCachedSearch(cacheNamespace, path, query),
      writeCachedSearch: (cacheNamespace, path, query, items) => portsRef.current.search.writeCachedSearch(cacheNamespace, path, query, items)
    },
    session: {
      terminate: (scope, reason) => {
        portsRef.current.session.resetActiveSession(
          reason === "unauthorized"
            ? "Session expired. Create a fresh session for this account."
            : `This account needs to be reconnected before ${scope === "folder" ? "browsing files" : "searching"}.`,
          reason === "reconnect-required"
        );
      }
    },
    availability: { setWorkerUnavailable: (unavailable) => portsRef.current.availability.setWorkerUnavailable(unavailable) },
    presentation: { setStatus: (message) => portsRef.current.presentation.setStatus(message) },
    folderSort: {
      service: portsRef.current.folderSort.service,
      persistBaseline: (mode) => portsRef.current.folderSort.persistBaseline(mode)
    }
  }), []);
  const workspace = useBrowsingWorkspace({
    context: input.context,
    mode: {
      folder: input.mode.explicitOffline
        ? "explicit-offline"
        : input.mode.browserOffline
          ? "offline"
          : input.mode.workerUnavailable
            ? "server-unavailable"
            : "online",
      search: input.mode.explicitOffline ? "explicit-offline" : "online",
      cacheOnly: input.mode.cacheOnly,
      explicitOffline: input.mode.explicitOffline,
      browserOffline: input.mode.browserOffline
    },
    settings: input.settings,
    offlineSource: input.offlineSource,
    ports: workspacePorts
  });
  const load = useFolderLoadCoordination({
    authority: {
      hasActiveAccount: Boolean(input.context.accountId),
      cacheNamespace: input.context.cacheNamespace,
      token: input.context.token,
      cacheOnlyMode: input.mode.cacheOnly
    },
    navigation: input.ports.navigation,
    reload: workspace.commands.reload
  });
  return { workspace, load };
}
