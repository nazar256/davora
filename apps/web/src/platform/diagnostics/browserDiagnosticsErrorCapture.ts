/**
 * Global error capture adapter: subscribes to `error` and
 * `unhandledrejection` window events while diagnostics are enabled.
 */

export interface CapturedBrowserError {
  readonly source: "error" | "unhandledrejection";
  readonly message: string;
  readonly stack?: string;
}

const rejectionMessage = (reason: unknown): string => {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  try {
    return JSON.stringify(reason) ?? "Unknown rejection";
  } catch {
    return "Unknown rejection";
  }
};

export const createBrowserDiagnosticsErrorCapture = () => ({
  subscribe(onError: (error: CapturedBrowserError) => void): () => void {
    const onErrorEvent = (event: ErrorEvent) => {
      onError({
        source: "error",
        message: event.error instanceof Error ? event.error.message : event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      onError({
        source: "unhandledrejection",
        message: rejectionMessage(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : undefined
      });
    };
    window.addEventListener("error", onErrorEvent);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onErrorEvent);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }
});
