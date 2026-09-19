import { ApiRequestError } from "../../lib/api";

export const PREVIEW_SESSION_EXPIRED_MESSAGE = "Session expired. Create a fresh session for this account.";
export const PREVIEW_RECONNECT_REQUIRED_MESSAGE = "This account needs to be reconnected before opening files.";

export type PreviewFailure =
  | { readonly kind: "aborted" }
  | { readonly kind: "session-terminal"; readonly reason: "session-expired"; readonly message: typeof PREVIEW_SESSION_EXPIRED_MESSAGE }
  | { readonly kind: "session-terminal"; readonly reason: "reconnect-required"; readonly message: typeof PREVIEW_RECONNECT_REQUIRED_MESSAGE }
  | { readonly kind: "backend-unavailable"; readonly message: string }
  | { readonly kind: "ordinary"; readonly message: string };

/** Structural browser-boundary service; feature code supplies only plain errors. */
export interface PreviewFailureClassifier {
  classify(error: unknown): PreviewFailure;
}

function abortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function transientBootstrapError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 && error.code !== "config_error";
  }
  return error instanceof TypeError || (error instanceof Error && /fetch|network|proxy|socket|connection/i.test(error.message));
}

function ordinaryMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unable to open file.";
}

export function createPreviewFailureClassifier(): PreviewFailureClassifier {
  return {
    classify(error) {
      if (abortError(error)) {
        return { kind: "aborted" };
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        return { kind: "session-terminal", reason: "session-expired", message: PREVIEW_SESSION_EXPIRED_MESSAGE };
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        return { kind: "session-terminal", reason: "reconnect-required", message: PREVIEW_RECONNECT_REQUIRED_MESSAGE };
      }
      if (transientBootstrapError(error)) {
        return { kind: "backend-unavailable", message: ordinaryMessage(error) };
      }
      return { kind: "ordinary", message: ordinaryMessage(error) };
    }
  };
}
