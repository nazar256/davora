/**
 * Browser environment snapshot for diagnostics. Reads only freely exposed
 * platform facts — it never requests permissions and never touches storage,
 * credentials, or content.
 */

interface NavigatorConnectionLike {
  readonly effectiveType?: string;
}

type DiagnosticsNavigator = Navigator & {
  readonly standalone?: boolean;
  readonly connection?: NavigatorConnectionLike;
  readonly platform?: string;
};

const diagnosticsNavigator = (): DiagnosticsNavigator => navigator;

const displayMode = (): "standalone" | "browser" => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || diagnosticsNavigator().standalone === true
        ? "standalone"
        : "browser";
  } catch {
    return "browser";
  }
};

const colorScheme = (): "light" | "dark" | undefined => {
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const storageEstimate = async (): Promise<{ usage?: number; quota?: number } | undefined> => {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) {
      return undefined;
    }
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return undefined;
  }
};

export const createBrowserDiagnosticsEnvironment = (appBuild: string) => ({
  async capture() {
    const nav = diagnosticsNavigator();
    return {
      appBuild,
      userAgent: nav.userAgent,
      platform: nav.platform,
      language: nav.language,
      languages: nav.languages ? [...nav.languages] : undefined,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      colorScheme: colorScheme(),
      displayMode: displayMode(),
      connectionEffectiveType: nav.connection?.effectiveType,
      onLine: nav.onLine,
      serviceWorkerControlled: nav.serviceWorker?.controller != null,
      storageEstimate: await storageEstimate()
    };
  }
});
