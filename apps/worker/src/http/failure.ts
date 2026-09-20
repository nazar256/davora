import type { ApiErrorCode } from "@davora/shared";

import { FileBackendFailureError, normalizeFileBackendFailure } from "../files/fileBackendError";
import { WorkerConfigurationError } from "../config";
import { errorResponse } from "../security/http";
import { TokenVerificationError, type TokenVerificationFailureKind } from "../security/token";

export type WorkerFailureKind =
  | "invalid_request"
  | "unsupported_account_type"
  | "permission_denied"
  | "origin_denied"
  | "permission_denied_context"
  | "account_revoked"
  | "account_reconnect_required"
  | "account_validation_failed"
  | "account_required"
  | "invalid_unlock_code"
  | "session_creation_failed"
  | "account_store_failure"
  | "bad_download_request"
  | "missing_bearer"
  | "missing_stream_token"
  | "malformed_token"
  | "invalid_token_signature"
  | "invalid_session_scope"
  | "invalid_stream_scope"
  | "token_expired"
  | "stream_path_mismatch"
  | "session_mismatch"
  | "invalid_file_query"
  | "invalid_stream_token_path"
  | "invalid_mutation_body"
  | "invalid_move_copy_json"
  | "delete_confirmation_required"
  | "conflict"
  | "resource_not_found"
  | "file_not_found"
  | "backend_permission_denied"
  | "mutation_failed"
  | "not_found"
  | "config_error"
  | "local_state_error"
  | "unexpected_error";

export interface WorkerFailureSpec {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
}

const specs: Record<WorkerFailureKind, WorkerFailureSpec> = {
  invalid_request: { status: 400, code: "invalid_request", message: "Request body is invalid." },
  unsupported_account_type: { status: 400, code: "unsupported_account_type", message: "Only Nextcloud accounts are supported in this pass." },
  permission_denied: { status: 403, code: "permission_denied", message: "Browser ownership headers are required." },
  origin_denied: { status: 403, code: "permission_denied", message: "Request origin is not allowed." },
  permission_denied_context: { status: 403, code: "permission_denied", message: "Connected account belongs to a different browser context." },
  account_revoked: { status: 410, code: "account_revoked", message: "Account has been revoked." },
  account_reconnect_required: { status: 409, code: "account_reconnect_required", message: "Connected account is no longer available. Reconnect this account." },
  account_validation_failed: { status: 400, code: "account_validation_failed", message: "Unable to connect account." },
  account_required: { status: 400, code: "account_required", message: "Select and connect an account before creating a session." },
  invalid_unlock_code: { status: 401, code: "invalid_unlock_code", message: "Unlock code is invalid." },
  session_creation_failed: { status: 400, code: "session_creation_failed", message: "Unable to create a session." },
  account_store_failure: { status: 500, code: "internal_error", message: "Account store persistence failed." },
  bad_download_request: { status: 400, code: "bad_request", message: "Download request is missing required fields." },
  missing_bearer: { status: 401, code: "unauthorized", message: "Missing bearer token." },
  missing_stream_token: { status: 401, code: "unauthorized", message: "Missing stream token." },
  malformed_token: { status: 401, code: "unauthorized", message: "Malformed session token." },
  invalid_token_signature: { status: 401, code: "unauthorized", message: "Invalid session token signature." },
  invalid_session_scope: { status: 401, code: "unauthorized", message: "Invalid session token scope." },
  invalid_stream_scope: { status: 401, code: "unauthorized", message: "Invalid stream token scope." },
  token_expired: { status: 401, code: "unauthorized", message: "Token expired." },
  stream_path_mismatch: { status: 401, code: "unauthorized", message: "Stream token does not match the requested path." },
  session_mismatch: { status: 401, code: "session_mismatch", message: "Session no longer matches the selected account configuration." },
  invalid_file_query: { status: 400, code: "invalid_request", message: "File path query was invalid." },
  invalid_stream_token_path: { status: 400, code: "invalid_request", message: "File path query was invalid." },
  invalid_mutation_body: { status: 400, code: "invalid_request", message: "Request body is invalid." },
  invalid_move_copy_json: { status: 400, code: "invalid_request", message: "Request body is invalid." },
  delete_confirmation_required: { status: 400, code: "delete_confirmation_required", message: "Delete confirmation does not match the target name." },
  conflict: { status: 409, code: "conflict", message: "Destination already exists." },
  resource_not_found: { status: 404, code: "not_found", message: "Resource not found." },
  file_not_found: { status: 404, code: "not_found", message: "File not found." },
  backend_permission_denied: { status: 403, code: "permission_denied", message: "Permission denied." },
  mutation_failed: { status: 500, code: "mutation_failed", message: "File backend operation failed." },
  not_found: { status: 404, code: "not_found", message: "Route not found." },
  config_error: { status: 500, code: "config_error", message: "Configuration error." },
  local_state_error: { status: 500, code: "local_state_error", message: "Unable to load local account state." },
  unexpected_error: { status: 500, code: "unexpected_error", message: "Unexpected error." }
};

export interface WorkerFailure extends Error {
  readonly kind: WorkerFailureKind;
  readonly causeCategory: unknown;
  readonly safeMessageOverride: string | undefined;
}

class WorkerFailureError extends Error implements WorkerFailure {
  constructor(
    readonly kind: WorkerFailureKind,
    readonly causeCategory: unknown = undefined,
    readonly safeMessageOverride: string | undefined = undefined
  ) {
    super(specs[kind].message);
    this.name = "WorkerFailure";
  }
}

export function workerFailure(kind: WorkerFailureKind, causeCategory?: unknown): WorkerFailure {
  return new WorkerFailureError(kind, causeCategory);
}

export function isWorkerFailure(error: unknown): error is WorkerFailure {
  return error instanceof WorkerFailureError;
}

export function workerFailureSpec(kind: WorkerFailureKind): WorkerFailureSpec {
  return specs[kind];
}

function tokenFailureKind(kind: TokenVerificationFailureKind): WorkerFailureKind {
  switch (kind) {
    case "malformed": return "malformed_token";
    case "invalid_signature": return "invalid_token_signature";
    case "expired": return "token_expired";
    case "invalid_session_scope": return "invalid_session_scope";
    case "invalid_stream_scope": return "invalid_stream_scope";
  }
}

export function normalizeWorkerFailure(error: unknown, fallback: WorkerFailureKind = "unexpected_error"): WorkerFailure {
  if (isWorkerFailure(error)) return error;
  if (error instanceof TokenVerificationError) return workerFailure(tokenFailureKind(error.kind), error.kind);
  return workerFailure(fallback, error instanceof Error ? error.name : typeof error);
}

export function normalizeConfigurationWorkerFailure(error: unknown): WorkerFailure {
  if (error instanceof WorkerConfigurationError) {
    return new WorkerFailureError("config_error", error.name, error.safeMessage);
  }
  return workerFailure("config_error", error instanceof Error ? error.name : typeof error);
}

export function normalizeFileWorkerFailure(error: unknown): WorkerFailure {
  const failure = normalizeFileBackendFailure(
    error instanceof FileBackendFailureError ? new Error(error.failure.message) : error
  );
  const kind: WorkerFailureKind = failure.kind === "reconnect_required"
    ? "account_reconnect_required"
    : failure.kind === "confirmation_required"
      ? "delete_confirmation_required"
      : failure.kind === "conflict"
        ? "conflict"
        : failure.kind === "not_found"
          ? "resource_not_found"
          : failure.kind === "permission_denied"
            ? "backend_permission_denied"
            : "mutation_failed";
  return new WorkerFailureError(kind, failure.kind, failure.message);
}

export function workerFailureResponse(error: unknown, fallback: WorkerFailureKind = "unexpected_error"): Response {
  const failure = normalizeWorkerFailure(error, fallback);
  const spec = specs[failure.kind];
  return errorResponse(spec.status, spec.code, failure.safeMessageOverride ?? spec.message);
}
