import type { FileEntry } from "@davora/shared";

import type { SelectionOrigin } from "./model";

export interface SelectionTimerPorts {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number | undefined): void;
}

export interface SelectionChromePorts {
  isNarrowScreen(): boolean;
  isMobileDetailsOpen(): boolean;
  openMobileDetails(options?: { pushHistory?: boolean }): void;
  closeMobileDetails(): void;
}

export interface SelectionFocusedPorts {
  current(): FileEntry | undefined;
  select(entry: FileEntry): void;
  clear(): void;
  hasSelectedPreview(): boolean;
  showMobileActions(): void;
}

export interface SelectionBatchPorts {
  isSelected(path: string): boolean;
  toggle(entry: FileEntry, origin: SelectionOrigin): void;
  selectAll(entries: readonly FileEntry[], origin: SelectionOrigin): void;
  deselectPaths(paths: readonly string[]): void;
  clear(): void;
}

export interface SelectionScopePorts {
  isSearchActive(): boolean;
  getCurrentPath(): string;
}

export interface SelectionInteractionPorts {
  timer: SelectionTimerPorts;
  chrome: SelectionChromePorts;
  focused: SelectionFocusedPorts;
  batch: SelectionBatchPorts;
  scope: SelectionScopePorts;
}
