/**
 * Lifecycle adapter for diagnostics: visibility changes, page teardown,
 * deferred flush scheduling, and the coarse startup timing marker.
 */

export const createBrowserDiagnosticsLifecycle = () => ({
  onVisibilityChange(callback: (state: "visible" | "hidden") => void): () => void {
    const handler = () => {
      callback(document.visibilityState === "hidden" ? "hidden" : "visible");
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },

  onPageHide(callback: () => void): () => void {
    window.addEventListener("pagehide", callback);
    return () => window.removeEventListener("pagehide", callback);
  },

  scheduleFlush(callback: () => void, delayMs: number): () => void {
    const id = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(id);
  },

  startupDurationMs(): number | undefined {
    try {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry instanceof PerformanceNavigationTiming
        ? entry.loadEventEnd || entry.domContentLoadedEventEnd || entry.duration
        : undefined;
    } catch {
      return undefined;
    }
  }
});
