import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import type { OperationAbortHandle } from "./ports";
import {
  createOperationAbortRequest,
  isAbortRequestRegistered,
  releaseAbortRequest,
  shouldAbortRequest
} from "./model";

function createTestAbortHandle(): OperationAbortHandle {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort: () => {
      controller.abort();
    }
  };
}

function abortRequest(
  input: {
    readonly context: ReturnType<typeof createOperationContextToken>;
    readonly path?: string;
    readonly isValid?: () => boolean;
  }
) {
  return createOperationAbortRequest({
    ...input,
    abort: createTestAbortHandle()
  });
}

describe("operation context model", () => {
  it("aborts when the operation context token changes", () => {
    const captured = createOperationContextToken();
    const current = createOperationContextToken();
    const request = abortRequest({ context: captured });

    expect(shouldAbortRequest(request, captured, "/Docs")).toBe(false);
    expect(shouldAbortRequest(request, current, "/Docs")).toBe(true);
  });

  it("aborts path-scoped requests when the current path no longer matches", () => {
    const context = createOperationContextToken();
    const request = abortRequest({ context, path: "/Docs" });

    expect(shouldAbortRequest(request, context, "/Docs")).toBe(false);
    expect(shouldAbortRequest(request, context, "/Photos")).toBe(true);
  });

  it("leaves path-scoped requests alone when no path was captured", () => {
    const context = createOperationContextToken();
    const request = abortRequest({ context });

    expect(shouldAbortRequest(request, context, "/Photos")).toBe(false);
  });

  it("aborts when a custom validity predicate becomes false", () => {
    const context = createOperationContextToken();
    let valid = true;
    const request = abortRequest({
      context,
      isValid: () => valid
    });

    expect(shouldAbortRequest(request, context, "/Docs")).toBe(false);
    valid = false;
    expect(shouldAbortRequest(request, context, "/Docs")).toBe(true);
  });

  it("registers and releases abort requests exactly once", () => {
    const requests = new Set<ReturnType<typeof createOperationAbortRequest>>();
    const request = abortRequest({ context: createOperationContextToken() });

    requests.add(request);
    expect(isAbortRequestRegistered(requests, request)).toBe(true);

    releaseAbortRequest(requests, request);
    expect(isAbortRequestRegistered(requests, request)).toBe(false);

    releaseAbortRequest(requests, request);
    expect(isAbortRequestRegistered(requests, request)).toBe(false);
  });

  it("creates abort requests with optional path and validity hooks", () => {
    const context = createOperationContextToken();
    const isValid = vi.fn(() => true);
    const abort = createTestAbortHandle();
    const request = createOperationAbortRequest({
      context,
      abort,
      path: "/Docs",
      isValid
    });

    expect(request.context).toBe(context);
    expect(request.path).toBe("/Docs");
    expect(request.isValid).toBe(isValid);
    expect(request.abort).toBe(abort);
  });
});
