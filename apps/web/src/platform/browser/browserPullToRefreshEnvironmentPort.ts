export function createBrowserPullToRefreshEnvironmentPort() {
  return {
    getWindowScrollY: () => window.scrollY
  };
}
