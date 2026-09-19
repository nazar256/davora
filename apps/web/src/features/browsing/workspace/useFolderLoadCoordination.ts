import { useCallback, useLayoutEffect, useRef } from "react";

export interface FolderLoadCoordinationOptions {
  readonly preferCache?: boolean;
  readonly announceStatus?: boolean;
}

export type FolderLoadCoordinationResult = "session-terminated" | undefined;

export interface FolderLoadCoordinationInput {
  readonly authority: {
    readonly hasActiveAccount: boolean;
    readonly cacheNamespace?: string;
    readonly token?: string;
    readonly cacheOnlyMode: boolean;
  };
  readonly navigation: {
    getCurrentPath(): string;
    setCurrentPath(path: string): void;
  };
  reload(options?: FolderLoadCoordinationOptions): Promise<FolderLoadCoordinationResult>;
}

export interface FolderLoadCoordination {
  loadFolder(path: string, options?: FolderLoadCoordinationOptions): Promise<FolderLoadCoordinationResult>;
}

export function useFolderLoadCoordination(input: FolderLoadCoordinationInput): FolderLoadCoordination {
  const inputRef = useRef(input);

  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);

  const loadFolder = useCallback(async (
    path: string,
    options: FolderLoadCoordinationOptions = {}
  ): Promise<FolderLoadCoordinationResult> => {
    const current = inputRef.current;
    if ((!current.authority.token && !current.authority.cacheOnlyMode)
      || !current.authority.cacheNamespace
      || !current.authority.hasActiveAccount) {
      return;
    }

    if (path !== current.navigation.getCurrentPath()) {
      current.navigation.setCurrentPath(path);
      return;
    }

    return current.reload(options);
  }, []);

  return { loadFolder };
}
