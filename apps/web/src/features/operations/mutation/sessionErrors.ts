import { ApiRequestError } from "../../../lib/api";

export function isMutationUnauthorized(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 401;
}

export function isMutationReconnectRequired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "account_reconnect_required";
}

export function isMutationSessionTerminated(error: unknown): boolean {
  return isMutationUnauthorized(error) || isMutationReconnectRequired(error);
}

/**
 * Transient failures worth retrying inside a copy/move task: network drops,
 * timeouts, throttling, and server errors. Client errors (including conflicts)
 * and aborts are deterministic and must not be retried.
 */
export function isRetryableMutationError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof ApiRequestError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}
