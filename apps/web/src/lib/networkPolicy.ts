let backendNetworkBlocked = false;
const activeAborters = new Set<() => void>();

/** Privacy-safe backend request observation emitted after each fetch settles. */
export interface BackendRequestObservation {
  readonly method: string;
  /** URL path and query shape only — never credentials or body content. */
  readonly url: string;
  readonly durationMs: number;
  readonly result: "status" | "network-error" | "aborted" | "blocked";
  readonly status?: number;
}

let requestObserver: ((observation: BackendRequestObservation) => void) | null = null;

/** Diagnostics hook: at most one observer; observer failures are swallowed. */
export function setBackendRequestObserver(
  observer: ((observation: BackendRequestObservation) => void) | null
): void {
  requestObserver = observer;
}

const emitObservation = (observation: BackendRequestObservation): void => {
  try {
    requestObserver?.(observation);
  } catch {
    // Diagnostics must never break request handling.
  }
};

const requestUrlShape = (input: string | URL): string => {
  try {
    const parsed = new URL(String(input), "https://davora.invalid");
    const queryKeys = [...parsed.searchParams.keys()];
    return queryKeys.length > 0 ? `${parsed.pathname}?${queryKeys.join(",")}` : parsed.pathname;
  } catch {
    return "<unparseable-url>";
  }
};

export class BackendNetworkBlockedError extends Error {
  constructor() {
    super("Backend requests are disabled while explicit offline mode is active.");
    this.name = "BackendNetworkBlockedError";
  }
}

export function setBackendNetworkBlocked(blocked: boolean): void {
  backendNetworkBlocked = blocked;
  if (!blocked) {
    return;
  }
  for (const abort of [...activeAborters]) {
    abort();
  }
  activeAborters.clear();
}

export function assertBackendNetworkAllowed(): void {
  if (backendNetworkBlocked) {
    throw new BackendNetworkBlockedError();
  }
}

export function registerBackendRequestAbort(abort: () => void): () => void {
  assertBackendNetworkAllowed();
  activeAborters.add(abort);
  return () => activeAborters.delete(abort);
}

/** The consumer must finish body work in scope and return only application data. */
export async function withBackendResponse<T>(
  input: string | URL,
  init: RequestInit,
  consume: (response: Response, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const method = (init.method ?? "GET").toUpperCase();
  const url = requestUrlShape(input);
  try {
    assertBackendNetworkAllowed();
  } catch (error) {
    emitObservation({ method, url, durationMs: Date.now() - startedAt, result: "blocked" });
    throw error;
  }
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (init.signal?.aborted) {
    controller.abort();
  } else {
    init.signal?.addEventListener("abort", onCallerAbort, { once: true });
  }
  const unregister = registerBackendRequestAbort(() => controller.abort());
  let receivedHeaders = false;
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    receivedHeaders = true;
    emitObservation({
      method,
      url,
      durationMs: Date.now() - startedAt,
      result: "status",
      status: response.status
    });
    const result = await consume(response, controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (!receivedHeaders) {
      emitObservation({
        method,
        url,
        durationMs: Date.now() - startedAt,
        result: controller.signal.aborted ? "aborted" : "network-error"
      });
    }
    if (controller.signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    throw error;
  } finally {
    controller.abort();
    unregister();
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}
