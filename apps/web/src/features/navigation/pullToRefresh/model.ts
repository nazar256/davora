import type { OpenSurfacesSnapshot } from "../model";

export const PULL_TO_REFRESH_THRESHOLD_PX = 120;
export const PULL_TO_REFRESH_VISIBLE_PROGRESS = 0.1;

export type PullToRefreshGesturePhase = "idle" | "pulling" | "refreshing";

export interface PullToRefreshGestureState {
  readonly phase: PullToRefreshGesturePhase;
  readonly progress: number;
  readonly visible: boolean;
  readonly refreshing: boolean;
}

export interface PullToRefreshScrollOrigin {
  readonly windowScrollY: number;
  readonly fileListScrollTop: number;
}

export interface PullToRefreshEligibilityInput {
  readonly cacheOnlyMode: boolean;
  readonly currentPath: string;
  readonly token: string | undefined;
  readonly openSurfaces: OpenSurfacesSnapshot;
  readonly scrollOrigin: PullToRefreshScrollOrigin;
}

export const isScrollAtOrigin = (scrollOrigin: PullToRefreshScrollOrigin): boolean =>
  scrollOrigin.windowScrollY <= 0 && scrollOrigin.fileListScrollTop <= 0;

export const hasAnyOpenSurface = (openSurfaces: OpenSurfacesSnapshot): boolean =>
  openSurfaces.preview
  || openSurfaces.action
  || openSurfaces.destination
  || openSurfaces.account
  || openSurfaces.removeAccount
  || openSurfaces.folderShortcut
  || openSurfaces.settings
  || openSurfaces.search
  || openSurfaces.navigation
  || openSurfaces.mobileDetails
  || openSurfaces.transfers;

export const isPullToRefreshEligible = (input: PullToRefreshEligibilityInput): boolean =>
  !input.cacheOnlyMode
  && isScrollAtOrigin(input.scrollOrigin)
  && input.currentPath.length > 0
  && Boolean(input.token)
  && !hasAnyOpenSurface(input.openSurfaces);

export const computePullToRefreshProgress = (pullDistancePx: number): number =>
  Math.min(Math.max(pullDistancePx, 0) / PULL_TO_REFRESH_THRESHOLD_PX, 1);

export const isPullToRefreshIndicatorVisible = (progress: number): boolean =>
  progress > PULL_TO_REFRESH_VISIBLE_PROGRESS;

export const initialPullToRefreshGestureState = (): PullToRefreshGestureState => Object.freeze({
  phase: "idle",
  progress: 0,
  visible: false,
  refreshing: false
});

export const beginPullToRefreshGesture = (): PullToRefreshGestureState => Object.freeze({
  phase: "pulling",
  progress: 0,
  visible: false,
  refreshing: false
});

export const updatePullToRefreshGesture = (
  state: PullToRefreshGestureState,
  pullDistancePx: number
): PullToRefreshGestureState => {
  if (state.phase !== "pulling") {
    return state;
  }
  const progress = computePullToRefreshProgress(pullDistancePx);
  return Object.freeze({
    phase: "pulling",
    progress,
    visible: isPullToRefreshIndicatorVisible(progress),
    refreshing: false
  });
};

export const shouldCommitPullToRefresh = (progress: number): boolean => progress >= 1;

export const cancelPullToRefreshGesture = (): PullToRefreshGestureState =>
  initialPullToRefreshGestureState();

export const commitPullToRefreshGesture = (): PullToRefreshGestureState => Object.freeze({
  phase: "refreshing",
  progress: 1,
  visible: true,
  refreshing: true
});

export const completePullToRefreshGesture = (): PullToRefreshGestureState =>
  initialPullToRefreshGestureState();
