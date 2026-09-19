export interface BrowserHistoryPort {
  pushState(state: unknown, url?: string): void;
  replaceState(state: unknown, url?: string): void;
  getState(): unknown;
  getLocation(): { readonly href: string; readonly search: string };
  subscribe(listener: (state: unknown) => void): () => void;
}

interface BrowserHistory {
  pushState(state: unknown, unused: string, url?: string | URL | null): void;
  replaceState(state: unknown, unused: string, url?: string | URL | null): void;
  readonly state: unknown;
}

interface BrowserLocation {
  readonly href: string;
  readonly search: string;
}

interface BrowserWindowEvents {
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  readonly location: BrowserLocation;
}

export const createBrowserHistoryPort = (
  resolveHistory: () => BrowserHistory = () => window.history,
  resolveWindow: () => BrowserWindowEvents = () => window
): BrowserHistoryPort => {
  const history = resolveHistory();
  const win = resolveWindow();

  return {
    pushState(state, url) {
      history.pushState(state, "", url);
    },
    replaceState(state, url) {
      history.replaceState(state, "", url);
    },
    getState() {
      return history.state;
    },
    getLocation(): BrowserLocation {
      return win.location;
    },
    subscribe(listener) {
      const handler = (event: PopStateEvent) => listener(event.state);
      win.addEventListener("popstate", handler);
      return () => win.removeEventListener("popstate", handler);
    }
  };
};
