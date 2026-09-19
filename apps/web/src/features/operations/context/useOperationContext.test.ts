import { act, renderHook } from "@testing-library/react";
import type { CapabilitySet } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { createOperationContextToken, type OperationMode } from "../policy";
import type { OperationContextPorts } from "./ports";
import { useOperationContext } from "./useOperationContext";

const testCapabilities: CapabilitySet = {
  backend: "mock",
  readOnly: false,
  search: true,
  preview: true,
  download: true,
  offlineCache: false,
  createFolder: true,
  upload: true,
  move: true,
  copy: true,
  delete: true,
  mediaPreview: true,
  markdownPreview: true,
  openedFileCache: true
};

const testPorts: OperationContextPorts = {
  createAbortHandle: () => {
    const controller = new AbortController();
    return {
      signal: controller.signal,
      abort: () => {
        controller.abort();
      }
    };
  }
};

function renderOperationContext(input: {
  accountId?: string;
  operationMode?: OperationMode;
  token?: string;
  currentPath?: string;
}) {
  return renderHook((props: typeof input) => useOperationContext({
    accountId: props.accountId,
    operationMode: props.operationMode ?? "online",
    token: props.token,
    capabilities: testCapabilities,
    currentPath: props.currentPath ?? "/Docs",
    ports: testPorts
  }), { initialProps: input });
}

describe("useOperationContext", () => {
  it("reuses the token while account, mode, and session stay stable", () => {
    const { result, rerender } = renderOperationContext({ accountId: "account-a", token: "session-a" });

    const firstToken = result.current.token;
    rerender({ accountId: "account-a", token: "session-a" });
    expect(result.current.token).toBe(firstToken);

    rerender({ accountId: "account-b", token: "session-a" });
    expect(result.current.token).not.toBe(firstToken);
  });

  it("aborts registered requests when the context token changes", () => {
    const { result, rerender } = renderOperationContext({ token: "session-a" });

    const context = result.current.token;
    const scope = result.current.registry.acquire({
      context,
      intent: { kind: "downloadFocused", present: true, isFolder: false }
    });
    expect(scope).toBeDefined();
    expect(scope?.signal.aborted).toBe(false);

    rerender({ token: "session-b" });
    expect(scope?.signal.aborted).toBe(true);
  });

  it("aborts path-scoped requests when navigation changes", () => {
    const { result, rerender } = renderOperationContext({ currentPath: "/Docs" });

    const scope = result.current.registry.acquire({
      context: result.current.token,
      path: "/Docs",
      intent: { kind: "upload", requiresFolderCreation: false },
      ownership: { checkPath: "/Docs" }
    });
    expect(scope?.signal.aborted).toBe(false);

    rerender({ currentPath: "/Photos" });
    expect(scope?.signal.aborted).toBe(true);
  });

  it("rejects upload acquires that are not immediately owned", () => {
    const { result } = renderOperationContext({ currentPath: "/Docs" });

    const scope = result.current.registry.acquire({
      context: result.current.token,
      path: "/Photos",
      intent: { kind: "upload", requiresFolderCreation: false },
      ownership: { checkPath: "/Photos" },
      rejectUnlessImmediateOwner: true
    });

    expect(scope).toBeUndefined();
  });

  it("releases registered requests exactly once", () => {
    const { result } = renderOperationContext({});

    const scope = result.current.registry.acquire({
      context: result.current.token,
      intent: { kind: "downloadFocused", present: true, isFolder: false }
    });
    expect(scope?.isRegistered()).toBe(true);

    act(() => {
      scope?.release();
    });
    expect(scope?.isRegistered()).toBe(false);

    act(() => {
      scope?.release();
    });
    expect(scope?.isRegistered()).toBe(false);
  });

  it("reads the latest environment through predicate helpers", () => {
    const { result, rerender } = renderOperationContext({
      accountId: "account-a",
      token: "session-a",
      operationMode: "online"
    });

    expect(result.current.isOperationAllowed({ kind: "createFolder" })).toBe(true);
    rerender({
      accountId: "account-a",
      token: "session-a",
      operationMode: "explicit-offline"
    });
    expect(result.current.isOperationAllowed({ kind: "createFolder" })).toBe(false);
    expect(result.current.isOperationAllowedForRender({ kind: "createFolder" })).toBe(false);
  });

  it("requires registration, current context, and allowed intent for ownership", () => {
    const { result } = renderOperationContext({});

    const staleContext = createOperationContextToken();
    const scope = result.current.registry.acquire({
      context: staleContext,
      intent: { kind: "downloadFocused", present: true, isFolder: false }
    });

    expect(scope?.isOwned()).toBe(false);
    expect(result.current.isOperationContextAllowed(staleContext, { kind: "downloadFocused", present: true, isFolder: false }))
      .toBe(false);
    expect(result.current.isCurrentOperationHandler()).toBe(true);
  });

  it("aborts every registered request on unmount", () => {
    const { result, unmount } = renderOperationContext({});

    const scope = result.current.registry.acquire({
      context: result.current.token,
      intent: { kind: "downloadFocused", present: true, isFolder: false }
    });
    unmount();
    expect(scope?.signal.aborted).toBe(true);
  });
});
