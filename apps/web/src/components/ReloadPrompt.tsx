import { useEffect, useState } from "react";

import { useRegisterSW } from "virtual:pwa-register/react";

type InstallOutcome = "accepted" | "dismissed";
type InstallChoice = { outcome: InstallOutcome; platform?: string };

interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<InstallChoice>;
  prompt(): Promise<void>;
}

export function shouldShowUpdatePrompt(needRefresh: boolean, mode: string = import.meta.env.MODE): boolean {
  return needRefresh && mode !== "development";
}

export interface PwaPromptState {
  installAvailable: boolean;
  installing: boolean;
  reloading: boolean;
  needRefresh: boolean;
  dismissUpdatePrompt(): void;
  installApp(): Promise<void>;
  reloadApp(): Promise<void>;
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePwaPromptState(): PwaPromptState {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({ immediate: true });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | undefined>();
  const [installing, setInstalling] = useState(false);
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [standalone, setStandalone] = useState(() => isStandaloneMode());
  const visibleNeedRefresh = shouldShowUpdatePrompt(needRefresh);

  const reloadWindow = () => {
    if (/jsdom/i.test(window.navigator.userAgent)) {
      return;
    }

    try {
      window.location.reload();
    } catch {
      // jsdom/navigation-less runtimes can throw here; real browsers should reload normally.
    }
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const syncStandalone = () => setStandalone(isStandaloneMode());
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallPromptDismissed(false);
    };
    const onAppInstalled = () => {
      setStandalone(true);
      setInstallPrompt(undefined);
      setInstallPromptDismissed(false);
    };

    syncStandalone();
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);
    mediaQuery.addEventListener("change", syncStandalone);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
      mediaQuery.removeEventListener("change", syncStandalone);
    };
  }, []);

  useEffect(() => {
    if (!offlineReady) {
      return;
    }

    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!needRefresh || shouldShowUpdatePrompt(true)) {
      return;
    }

    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh]);

  const installAvailable = Boolean(installPrompt) && !installPromptDismissed && !standalone;

  const installApp = async () => {
    if (!installPrompt) {
      return;
    }

    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPrompt(undefined);
        setInstallPromptDismissed(false);
        return;
      }

      setInstallPromptDismissed(true);
    } catch {
      setInstallPromptDismissed(true);
    } finally {
      setInstalling(false);
    }
  };

  const reloadApp = async () => {
    if (reloading) {
      return;
    }

    setReloading(true);
    const serviceWorker = navigator.serviceWorker;
    let timeoutId: number | undefined;

    try {
      if (serviceWorker) {
        const triggerReload = () => {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
          reloadWindow();
        };

        const onControllerChange = () => {
          serviceWorker.removeEventListener("controllerchange", onControllerChange);
          triggerReload();
        };

        serviceWorker.addEventListener("controllerchange", onControllerChange);
        timeoutId = window.setTimeout(() => {
          serviceWorker.removeEventListener("controllerchange", onControllerChange);
          triggerReload();
        }, 1500);
      }

      await updateServiceWorker(true);

      if (!serviceWorker) {
        reloadWindow();
      }
    } finally {
      setReloading(false);
    }
  };

  return {
    installAvailable,
    installing,
    reloading,
    needRefresh: visibleNeedRefresh,
    dismissUpdatePrompt: () => setNeedRefresh(false),
    installApp,
    reloadApp
  };
}

interface ReloadPromptProps {
  needRefresh: boolean;
  onDismiss(): void;
  onReload(): Promise<void>;
  reloading: boolean;
}

export function ReloadPrompt({ needRefresh, onDismiss, onReload, reloading }: ReloadPromptProps) {
  if (!needRefresh) {
    return null;
  }

  return (
    <div className="toast" role="status" aria-live="polite">
      <div>Updated app shell ready. Reload to apply it now.</div>
      <div className="toast-actions">
        <button disabled={reloading} onClick={() => void onReload()} type="button">{reloading ? "Reloading…" : "Reload"}</button>
        <button disabled={reloading} onClick={onDismiss} type="button">Dismiss</button>
      </div>
    </div>
  );
}
