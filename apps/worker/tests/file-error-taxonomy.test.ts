import { describe, expect, it } from "vitest";
import type { ApiErrorCode } from "@davora/shared";
import { normalizeFileBackendFailure } from "../src/files/fileBackendError";
import { errorResponse } from "../src/security/http";

describe("file backend failure taxonomy", () => {
  it.each([
    ["Reconnect this account before browsing files.", "reconnect_required"],
    ["Delete confirmation does not match the target name.", "confirmation_required"],
    ["Destination already exists.", "conflict"],
    ["Resource not found.", "not_found"],
    ["Permission denied by upstream.", "permission_denied"]
  ] as const)("normalizes %s", (message, kind) => {
    expect(normalizeFileBackendFailure(new Error(message))).toMatchObject({ kind });
  });

  it.each([
    ["Reconnect this account before browsing files. -- account-secret", "reconnect_required", "Reconnect this account before browsing files."],
    ["Delete confirmation does not match the target name. -- private-path", "confirmation_required", "Delete confirmation does not match the target name."],
    ["Destination already exists. -- bearer-token", "conflict", "Destination already exists."],
    ["Resource not found. -- /private/upstream/path", "not_found", "Resource not found."],
    ["Permission denied by upstream. -- authorization-detail", "permission_denied", "Permission denied."]
  ] as const)("redacts classified exception details for %s", (message, kind, safeMessage) => {
    const failure = normalizeFileBackendFailure(new Error(message));
    expect(failure).toEqual({ kind, message: safeMessage });
    expect(failure.message).not.toContain("--");
    expect(failure.message).not.toContain("account-secret");
    expect(failure.message).not.toContain("private-path");
    expect(failure.message).not.toContain("bearer-token");
    expect(failure.message).not.toContain("/private/upstream/path");
    expect(failure.message).not.toContain("authorization-detail");
  });

  it("redacts unknown upstream failures", () => {
    expect(normalizeFileBackendFailure(new Error("upstream secret password bearer-token"))).toEqual({ kind: "unknown", message: "File backend operation failed." });
  });

  it.each([
    ["Folder already exists.", "conflict"],
    ["Parent folder not found.", "not_found"],
    ["Configured root path was not found.", "not_found"]
  ] as const)("preserves the exact safe message from known source %s", (message, kind) => {
    expect(normalizeFileBackendFailure(new Error(message))).toEqual({ kind, message });
  });

  it("runtime-validates error envelopes before serialization", async () => {
    const response = errorResponse(400, "invalid_request", "Request was invalid.", "safe detail");
    expect(await response.json()).toEqual({ data: { code: "invalid_request", message: "Request was invalid.", details: "safe detail" } });
    expect(() => errorResponse(400, "not-a-code" as ApiErrorCode, "Request was invalid.")).toThrow();
  });
});
