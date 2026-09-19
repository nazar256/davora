/** Local structural copies keep platform adapters independent of feature modules. */
export interface BrowserBeforeInstallPromptEvent {
  readonly platforms?: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
  prompt(): Promise<void>;
  preventDefault(): void;
}

export interface BrowserPwaEnvironmentPorts {
  readonly isStandalone: () => boolean;
  readonly subscribeStandaloneChange: (listener: () => void) => () => void;
  readonly subscribeBeforeInstallPrompt: (handler: (event: BrowserBeforeInstallPromptEvent) => void) => () => void;
  readonly subscribeAppInstalled: (handler: () => void) => () => void;
  readonly reloadWindow: () => void;
  readonly waitForControllerChangeOrTimeout: (delayMs: number, onReady: () => void) => (() => void) | undefined;
}

function readStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isBeforeInstallPromptEvent(event: Event): event is Event & BrowserBeforeInstallPromptEvent {
  return "prompt" in event && typeof Reflect.get(event, "prompt") === "function";
}

export function createBrowserPwaPorts(): BrowserPwaEnvironmentPorts {
  return {
    isStandalone: readStandaloneMode,
    subscribeStandaloneChange: (listener) => {
      const mediaQuery = window.matchMedia("(display-mode: standalone)");
      const syncStandalone = () => listener();
      mediaQuery.addEventListener("change", syncStandalone);
      return () => mediaQuery.removeEventListener("change", syncStandalone);
    },
    subscribeBeforeInstallPrompt: (handler) => {
      const onBeforeInstallPrompt = (event: Event) => {
        event.preventDefault();
        if (!isBeforeInstallPromptEvent(event)) {
          return;
        }

        handler(event);
      };

      window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    },
    subscribeAppInstalled: (handler) => {
      window.addEventListener("appinstalled", handler);
      return () => window.removeEventListener("appinstalled", handler);
    },
    reloadWindow: () => {
      if (/jsdom/i.test(window.navigator.userAgent)) {
        return;
      }

      try {
        window.location.reload();
      } catch {
        // jsdom/navigation-less runtimes can throw here; real browsers should reload normally.
      }
    },
    waitForControllerChangeOrTimeout: (delayMs, onReady) => {
      const serviceWorker = navigator.serviceWorker;
      if (!serviceWorker) {
        return undefined;
      }

      let timeoutId: number | undefined;

      const triggerReady = () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
          timeoutId = undefined;
        }

        serviceWorker.removeEventListener("controllerchange", onControllerChange);
        onReady();
      };

      const onControllerChange = () => {
        triggerReady();
      };

      serviceWorker.addEventListener("controllerchange", onControllerChange);
      timeoutId = window.setTimeout(() => {
        triggerReady();
      }, delayMs);

      return () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }

        serviceWorker.removeEventListener("controllerchange", onControllerChange);
      };
    }
  } satisfies BrowserPwaEnvironmentPorts;
}
