import { describe, expect, it } from "vitest";

import { FileBackendFailureError } from "../src/files/fileBackendError";
import * as failureModule from "../src/http/failure";

import {
  normalizeFileWorkerFailure,
  workerFailure,
  workerFailureResponse,
  workerFailureSpec,
  type WorkerFailureKind
} from "../src/http/failure";

describe("common Worker failure taxonomy", () => {
  it("does not expose a constructible failure class outside the taxonomy module", () => {
    expect("WorkerFailure" in failureModule).toBe(false);
  });

  it("maps every closed failure to a redacted public envelope", async () => {
    const kinds: readonly WorkerFailureKind[] = [
      "invalid_request",
      "unsupported_account_type",
      "permission_denied",
      "permission_denied_context",
      "account_revoked",
      "account_reconnect_required",
      "account_validation_failed",
      "account_required",
      "invalid_unlock_code",
      "session_creation_failed",
      "account_store_failure",
      "bad_download_request",
      "missing_bearer",
      "missing_stream_token",
      "malformed_token",
      "invalid_token_signature",
      "invalid_session_scope",
      "invalid_stream_scope",
      "token_expired",
      "stream_path_mismatch",
      "session_mismatch",
      "invalid_file_query",
      "invalid_stream_token_path",
      "invalid_mutation_body",
      "invalid_move_copy_json",
      "not_found",
      "unexpected_error"
    ];

    for (const kind of kinds) {
      const response = workerFailureResponse(workerFailure(kind, new Error("secret-sentinel")));
      const body = await response.text();
      expect(response.status).toBe(workerFailureSpec(kind).status);
      expect(body).not.toContain("secret-sentinel");
    }
  });

  it("uses a closed fallback for unknown causes", async () => {
    const response = workerFailureResponse(new Error("UPSTREAM_SECRET_BODY"), "unexpected_error");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Unexpected error.");
  });

  it("revalidates even nominal backend failures before returning client text", async () => {
    const crafted = new FileBackendFailureError({
      kind: "not_found",
      message: "Resource not found. -- /private/upstream/path"
    });
    const response = workerFailureResponse(normalizeFileWorkerFailure(crafted));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("Resource not found.");
    expect(body).not.toContain("/private/upstream/path");
  });
});
