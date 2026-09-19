export interface PullToRefreshScrollOriginPort {
  readonly getWindowScrollY: () => number;
  readonly getFileListScrollTop: () => number;
}

export interface PullToRefreshEnvironmentPort {
  readonly getWindowScrollY: () => number;
}
