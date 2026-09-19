/** Structural so the feature has no DOM AbortController dependency. */
export interface OperationAbortHandle {
  readonly signal: AbortSignal;
  abort(): void;
}

export interface OperationContextPorts {
  createAbortHandle(): OperationAbortHandle;
}
