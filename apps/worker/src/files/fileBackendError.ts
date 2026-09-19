export type FileBackendFailureKind =
  | "reconnect_required"
  | "confirmation_required"
  | "conflict"
  | "not_found"
  | "permission_denied"
  | "unknown";

export interface FileBackendFailure {
  kind: FileBackendFailureKind;
  /** A safe, user-facing message. Unknown upstream details are intentionally redacted. */
  message: string;
}

export class FileBackendFailureError extends Error {
  readonly failure: FileBackendFailure;

  constructor(failure: FileBackendFailure) {
    super(failure.message);
    this.name = "FileBackendFailureError";
    this.failure = failure;
  }
}

const SAFE_MESSAGES: Record<Exclude<FileBackendFailureKind, "unknown">, string> = {
  reconnect_required: "Reconnect this account before browsing files.",
  confirmation_required: "Delete confirmation does not match the target name.",
  conflict: "Destination already exists.",
  not_found: "Resource not found.",
  permission_denied: "Permission denied."
};

const KNOWN_SAFE_MESSAGES = new Map<string, FileBackendFailure>([
  ["Reconnect this account before browsing files.", { kind: "reconnect_required", message: "Reconnect this account before browsing files." }],
  ["Delete confirmation does not match the target name.", { kind: "confirmation_required", message: "Delete confirmation does not match the target name." }],
  ["Destination already exists.", { kind: "conflict", message: "Destination already exists." }],
  ["Folder already exists.", { kind: "conflict", message: "Folder already exists." }],
  ["Resource not found.", { kind: "not_found", message: "Resource not found." }],
  ["Parent folder not found.", { kind: "not_found", message: "Parent folder not found." }],
  ["Configured root path was not found.", { kind: "not_found", message: "Configured root path was not found." }],
  ["Permission denied.", { kind: "permission_denied", message: "Permission denied." }]
]);

export function normalizeFileBackendFailure(error: unknown): FileBackendFailure {
  const message = error instanceof Error ? error.message : "";
  const knownSafeFailure = KNOWN_SAFE_MESSAGES.get(message);
  if (knownSafeFailure) return knownSafeFailure;
  if (/reconnect this account/i.test(message)) {
    return { kind: "reconnect_required", message: SAFE_MESSAGES.reconnect_required };
  }
  if (/confirmation/i.test(message)) {
    return { kind: "confirmation_required", message: SAFE_MESSAGES.confirmation_required };
  }
  if (/already exists/i.test(message)) {
    return { kind: "conflict", message: SAFE_MESSAGES.conflict };
  }
  if (/not found/i.test(message)) {
    return { kind: "not_found", message: SAFE_MESSAGES.not_found };
  }
  if (/permission/i.test(message)) {
    return { kind: "permission_denied", message: SAFE_MESSAGES.permission_denied };
  }
  return { kind: "unknown", message: "File backend operation failed." };
}

export async function normalizeFileBackendCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FileBackendFailureError) throw error;
    throw new FileBackendFailureError(normalizeFileBackendFailure(error));
  }
}
