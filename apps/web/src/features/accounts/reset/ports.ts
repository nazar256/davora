export interface SemanticAccountResetPorts {
  readonly preview: {
    clearAccountContext(): void;
  };
  readonly selection: {
    clearFocused(): void;
    clearBatch(): void;
  };
  readonly browsing: {
    clearQuery(): void;
    clearListError(): void;
  };
  readonly navigation: {
    getLocationSearch(): string;
    setPath(path: string): void;
    syncPath(path: string, accountId?: string): void;
    closeMobileDetails(): void;
  };
  readonly transfers: {
    failActiveForAccount(accountId: string, message: string): void;
  };
  readonly session: {
    applyTerminal(accountId: string, reconnectRequired: boolean): void;
  };
  readonly bootstrap: {
    setError(message: string): void;
  };
  readonly presentation: {
    setStatus(message: string): void;
  };
}
