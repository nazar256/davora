let backendNetworkBlocked = false;
const activeAborters = new Set<() => void>();

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
  assertBackendNetworkAllowed();
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (init.signal?.aborted) {
    controller.abort();
  } else {
    init.signal?.addEventListener("abort", onCallerAbort, { once: true });
  }
  const unregister = registerBackendRequestAbort(() => controller.abort());
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    unregister();
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}
