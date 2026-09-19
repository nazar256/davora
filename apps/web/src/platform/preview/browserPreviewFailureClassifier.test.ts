import { ApiRequestError } from "../../lib/api";
import { describe, expect, it } from "vitest";

import {
  PREVIEW_RECONNECT_REQUIRED_MESSAGE,
  PREVIEW_SESSION_EXPIRED_MESSAGE,
  createPreviewFailureClassifier
} from "./browserPreviewFailureClassifier";

describe("browser preview failure classifier", () => {
  const classifier = createPreviewFailureClassifier();

  it("keeps aborts inert", () => {
    const domAbort = new DOMException("Aborted", "AbortError");
    expect(domAbort.name).toBe("AbortError");
    expect(classifier.classify(domAbort)).toEqual({ kind: "aborted" });
    expect(classifier.classify(Object.assign(new Error("Aborted"), { name: "AbortError" }))).toEqual({ kind: "aborted" });
  });

  it("maps terminal account failures to the exact preview-session messages", () => {
    expect(classifier.classify(new ApiRequestError("ignored", 401))).toEqual({
      kind: "session-terminal",
      reason: "session-expired",
      message: PREVIEW_SESSION_EXPIRED_MESSAGE
    });
    expect(classifier.classify(new ApiRequestError("ignored", 403, "account_reconnect_required"))).toEqual({
      kind: "session-terminal",
      reason: "reconnect-required",
      message: PREVIEW_RECONNECT_REQUIRED_MESSAGE
    });
  });

  it("preserves the current transient bootstrap definition", () => {
    expect(classifier.classify(new ApiRequestError("Worker failed", 503))).toEqual({ kind: "backend-unavailable", message: "Worker failed" });
    expect(classifier.classify(new TypeError("fetch failed"))).toEqual({ kind: "backend-unavailable", message: "fetch failed" });
    expect(classifier.classify(new Error("proxy connection reset"))).toEqual({ kind: "backend-unavailable", message: "proxy connection reset" });
    expect(classifier.classify(new ApiRequestError("configuration invalid", 500, "config_error"))).toEqual({ kind: "ordinary", message: "configuration invalid" });
  });

  it("keeps ordinary failures and unknown values readable", () => {
    expect(classifier.classify(new Error("Cannot render this file."))).toEqual({ kind: "ordinary", message: "Cannot render this file." });
    expect(classifier.classify(undefined)).toEqual({ kind: "ordinary", message: "Unable to open file." });
  });
});
