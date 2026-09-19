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
