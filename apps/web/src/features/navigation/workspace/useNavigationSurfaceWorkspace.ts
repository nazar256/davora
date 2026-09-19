import type { OpenSurfacesSnapshot } from "../model";
import { usePullToRefreshWorkspace, type PullToRefreshWorkspace, type PullToRefreshWorkspaceInput } from "../pullToRefresh";
import { useWorkspaceSurfaceCoordinator, type WorkspaceSurfaceCoordinatorInput } from "../useWorkspaceSurfaceCoordinator";

export interface NavigationSurfaceWorkspaceInput {
  readonly surface: WorkspaceSurfaceCoordinatorInput;
  readonly pullToRefresh: Omit<PullToRefreshWorkspaceInput, "getOpenSurfaces">;
}

export interface NavigationSurfaceWorkspace {
  readonly getOpenSurfaces: () => OpenSurfacesSnapshot;
  readonly pullToRefresh: PullToRefreshWorkspace;
}

export function useNavigationSurfaceWorkspace(input: NavigationSurfaceWorkspaceInput): NavigationSurfaceWorkspace {
  const surface = useWorkspaceSurfaceCoordinator(input.surface);
  const pullToRefresh = usePullToRefreshWorkspace({
    ...input.pullToRefresh,
    getOpenSurfaces: surface.getOpenSurfaces
  });
  return {
    getOpenSurfaces: surface.getOpenSurfaces,
    pullToRefresh
  };
}
