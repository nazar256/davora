import type { DismissSurfaceKind, HistoryState } from "./model";

export interface NavigationCommandApplicationPorts {
  dismiss: {
    preview(): void;
    action(): void;
    destination(): void;
    account(): void;
    removeAccount(): void;
    folderShortcut(): void;
    reportBug(): void;
    chrome(surface: DismissSurfaceKind): void;
  };
  navigate: {
    clearSelectedEntry(): void;
    clearBatchSelection(): void;
    clearChromeForPathNavigate(): void;
    clearForPathTransition(): void;
    setCurrentPath(path: string): void;
  };
}

export interface NavigationCommandApplicationSource {
  closePreview(): void;
  dismissAction(): void;
  closeDestinationPicker(): void;
  setShowAccountDialog(open: boolean): void;
  setRemoveAccountTarget(target: undefined): void;
  dismissFolderShortcut(): void;
  closeReportBug(): void;
  dismissChrome(surface: DismissSurfaceKind): void;
  clearSelectedEntry(): void;
  clearBatchSelection(): void;
  clearChromeForPathNavigate(): void;
  clearForPathTransition(): void;
  setCurrentPath(path: string): void;
}

export interface HistoryPort {
  pushState(state: HistoryState, url?: string): void;
  replaceState(state: HistoryState, url?: string): void;
  getState(): unknown;
  /** Current browser location, exposed by the composition adapter. */
  getLocation(): { readonly href: string; readonly search: string };
  subscribe(listener: (state: unknown) => void): () => void;
}
