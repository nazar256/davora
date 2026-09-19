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

const requestUrlShape = (input: RequestInfo | URL): string => {
  try {
    const url = input instanceof Request ? input.url : String(input);
    const parsed = new URL(url, "https://davora.invalid");
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

export async function backendFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const startedAt = Date.now();
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
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
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    emitObservation({
      method,
      url,
      durationMs: Date.now() - startedAt,
      result: "status",
      status: response.status
    });
    return response;
  } catch (error) {
    emitObservation({
      method,
      url,
      durationMs: Date.now() - startedAt,
      result: controller.signal.aborted ? "aborted" : "network-error"
    });
    throw error;
  } finally {
    unregister();
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}
