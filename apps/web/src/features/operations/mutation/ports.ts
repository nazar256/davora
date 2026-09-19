import type { FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { FocusedSelectionCapture } from "../selection";
import type { SelectionSyncEffect } from "./model";

export interface MutationExecuteOptions {
  readonly refreshFolder?: boolean;
  readonly successStatus?: string | false;
  readonly syncSelection?: boolean;
  readonly manageBusy?: boolean;
  readonly context?: OperationContextToken;
  readonly intent?: OperationIntent;
  readonly isAttemptCurrent?: () => boolean;
  readonly busyOwner?: object;
}

export interface MutationSessionPort {
  hasSession(): boolean;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  resetExpired(message: string): void;
  resetReconnectRequired(message: string): void;
}

export interface MutationEnvironmentPort {
  isCacheOnlyBlocked(): boolean;
  isOffline(): boolean;
}

export interface MutationContextPort {
  getOperationContextToken(): OperationContextToken;
  isContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
}

export interface MutationFolderPort {
  getCurrentPath(): string;
  navigateToPath(path: string): void;
  refreshFolder(path: string): Promise<void>;
}

export interface MutationSelectionPort {
  currentFocusedSelection(): FileEntry | undefined;
  captureFocusedSelection(): FocusedSelectionCapture | undefined;
  isFocusedSelectionCurrent(capture: FocusedSelectionCapture): boolean;
  getSelectedPreview(): { readonly path: string; readonly name: string } | undefined;
  applySelectionSync(effect: SelectionSyncEffect, capture: FocusedSelectionCapture | undefined): void;
}

export interface MutationPresentationPort {
  clearListError(): void;
  setStatus(message: string): void;
  getAccountName(): string;
  toDisplayPath(path: string): string;
}

export interface MutationRunnerPorts {
  readonly session: MutationSessionPort;
  readonly environment: MutationEnvironmentPort;
  readonly context: MutationContextPort;
  readonly folder: MutationFolderPort;
  readonly selection: MutationSelectionPort;
  readonly presentation: MutationPresentationPort;
}
