import { useCallback, useSyncExternalStore } from "react";

import type { ResponsiveViewportPort } from "./ports";

export interface UseResponsiveViewportInput {
  readonly port: ResponsiveViewportPort;
}

/**
 * Owns the responsive viewport subscription for the lifetime of a port.
 * useSyncExternalStore makes replacement and cleanup commit-safe while the
 * port snapshot is read during render for a synchronous first-frame layout.
 */
export function useResponsiveViewport({ port }: UseResponsiveViewportInput) {
  const subscribe = useCallback((onStoreChange: () => void) => (
    port.subscribe(onStoreChange)
  ), [port]);
  const getSnapshot = useCallback(() => port.getSnapshot(), [port]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    snapshot,
    isNarrowScreen: snapshot.kind === "narrow"
  } as const;
}
