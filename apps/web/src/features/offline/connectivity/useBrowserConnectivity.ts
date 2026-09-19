import { useCallback, useSyncExternalStore } from "react";

import type { ConnectivityPort } from "./ports";

export interface UseBrowserConnectivityInput {
  readonly port: ConnectivityPort;
}

/**
 * Owns the browser-connectivity subscription for the lifetime of a port.
 * useSyncExternalStore keeps subscription replacement and cleanup commit-safe,
 * while reading the port during render preserves the first-frame fact.
 */
export function useBrowserConnectivity({ port }: UseBrowserConnectivityInput) {
  const subscribe = useCallback((onStoreChange: () => void) => (
    port.subscribe(() => onStoreChange())
  ), [port]);
  const read = useCallback(() => port.read(), [port]);
  const snapshot = useSyncExternalStore(subscribe, read, read);

  return {
    snapshot,
    offline: snapshot.kind === "offline"
  } as const;
}
