import { useMemo } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export interface BrowserPwaRegistrationState {
  readonly needRefresh: boolean;
  readonly setNeedRefresh: (value: boolean) => void;
  readonly offlineReady: boolean;
  readonly setOfflineReady: (value: boolean) => void;
  readonly updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function useBrowserPwaRegistration(): BrowserPwaRegistrationState {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({ immediate: true });

  return useMemo(
    () => ({
      needRefresh,
      setNeedRefresh,
      offlineReady,
      setOfflineReady,
      updateServiceWorker
    }),
    [needRefresh, setNeedRefresh, offlineReady, setOfflineReady, updateServiceWorker]
  );
}
