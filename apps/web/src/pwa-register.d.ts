declare module "virtual:pwa-register/react" {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedReload?: () => void;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration?: ServiceWorkerRegistration) => void;
    onRegisteredSW?: (swScriptUrl: string, registration?: ServiceWorkerRegistration) => void;
    onRegisterError?: (error: unknown) => void;
  }

  export function useRegisterSW(options?: RegisterSWOptions): {
    offlineReady: [boolean, (value: boolean) => void];
    needRefresh: [boolean, (value: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}
