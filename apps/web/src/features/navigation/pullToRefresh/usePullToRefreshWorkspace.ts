import { useRef, type ComponentProps, type Ref } from "react";

import type { OpenSurfacesSnapshot } from "../model";
import { usePullToRefresh } from "./usePullToRefresh";
import type { PullToRefreshEnvironmentPort, PullToRefreshScrollOriginPort } from "./ports";
import type { PullToRefreshIndicatorStageProps } from "./PullToRefreshIndicatorStage";

export interface PullToRefreshPathOptions {
  readonly preferCache: false;
}

export interface PullToRefreshWorkspaceInput {
  readonly cacheOnlyMode: boolean;
  readonly getCurrentPath: () => string;
  readonly getToken: () => string | undefined;
  readonly getOpenSurfaces: () => OpenSurfacesSnapshot;
  readonly environment: PullToRefreshEnvironmentPort;
  readonly refreshPath: (
    path: string,
    options: PullToRefreshPathOptions
  ) => Promise<unknown>;
}

export interface PullToRefreshShellBinding {
  readonly indicator: PullToRefreshIndicatorStageProps;
  readonly handlers: Pick<ComponentProps<"main">, "onTouchStart" | "onTouchMove" | "onTouchEnd">;
}

export interface PullToRefreshWorkspace {
  readonly shell: PullToRefreshShellBinding;
  readonly fileListRef: Ref<HTMLElement>;
}

export function usePullToRefreshWorkspace(input: PullToRefreshWorkspaceInput): PullToRefreshWorkspace {
  const fileListRef = useRef<HTMLElement | null>(null);
  const scrollOrigin: PullToRefreshScrollOriginPort = {
    getWindowScrollY: input.environment.getWindowScrollY,
    getFileListScrollTop: () => fileListRef.current?.scrollTop ?? 0
  };
  const pullToRefresh = usePullToRefresh({
    cacheOnlyMode: input.cacheOnlyMode,
    getCurrentPath: input.getCurrentPath,
    getToken: input.getToken,
    getOpenSurfaces: input.getOpenSurfaces,
    scrollOrigin,
    onRefresh: async () => {
      await input.refreshPath(input.getCurrentPath(), { preferCache: false });
    }
  });

  return {
    shell: {
      indicator: {
        visible: pullToRefresh.visible,
        progress: pullToRefresh.progress,
        refreshing: pullToRefresh.refreshing
      },
      handlers: pullToRefresh.handlers
    },
    fileListRef
  };
}
