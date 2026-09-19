import { StrictMode, useEffect } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CapabilitySet } from "@davora/shared";
import { useOperationAuthorityWorkspace } from "./useOperationAuthorityWorkspace";

const capabilities: CapabilitySet = {
  backend: "mock", readOnly: false, search: true, preview: true, download: true, offlineCache: true,
  createFolder: true, upload: true, move: true, copy: true, delete: true, mediaPreview: true, markdownPreview: true, openedFileCache: true
};

function renderAuthority(input: { accountId?: string; token?: string; currentPath?: string; explicitOffline?: boolean; browserOffline?: boolean; workerUnavailable?: boolean }) {
  return renderHook((props: typeof input) => useOperationAuthorityWorkspace({
    context: {
      accountId: props.accountId,
      accountName: "Alpha",
      token: props.token,
      capabilities,
      currentPath: props.currentPath ?? "/Docs",
      cacheOnlyMode: false,
      explicitOffline: props.explicitOffline ?? false,
      browserOffline: props.browserOffline ?? false,
      workerUnavailable: props.workerUnavailable ?? false,
      isNarrowScreen: false
    },
    createAbortHandle: () => {
      const controller = new AbortController();
      return { signal: controller.signal, abort: () => controller.abort() };
    }
  }), { initialProps: input });
}

describe("operation authority workspace", () => {
  it.each([
    [{}, "online"],
    [{ explicitOffline: true }, "explicit-offline"],
    [{ browserOffline: true }, "browser-offline"],
    [{ workerUnavailable: true }, "server-unavailable"]
  ])("normalizes mode %j", (input, mode) => {
    const { result } = renderAuthority(input);
    expect(result.current.environment.mode).toBe(mode);
  });

  it("replaces Alpha authority, aborts owned work, and rejects the old generation", () => {
    const { result, rerender, unmount } = renderAuthority({ accountId: "alpha", token: "alpha-session" });
    const old = result.current;
    const scope = old.registry.acquire({ context: old.token, intent: { kind: "downloadFocused", present: true, isFolder: false } });
    expect(scope?.signal.aborted).toBe(false);
    rerender({ accountId: "beta", token: "beta-session" });
    expect(scope?.signal.aborted).toBe(true);
    expect(old.isCurrentOperationContext(old.token)).toBe(false);
    const current = result.current.registry.acquire({ context: result.current.token, intent: { kind: "downloadFocused", present: true, isFolder: false } });
    unmount();
    expect(current?.signal.aborted).toBe(true);
  });

  it("releases each StrictMode replay scope exactly once", () => {
    const scopes: Array<{ isRegistered(): boolean; release(): void }> = [];
    const { unmount } = renderHook(() => {
      const authority = useOperationAuthorityWorkspace({
        context: { accountId: "alpha", accountName: "Alpha", token: "session", capabilities, currentPath: "/Docs", cacheOnlyMode: false, explicitOffline: false, browserOffline: false, workerUnavailable: false, isNarrowScreen: false },
        createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; }
      });
      useEffect(() => {
        const scope = authority.registry.acquire({ context: authority.token, intent: { kind: "downloadFocused", present: true, isFolder: false } });
        if (!scope) return undefined;
        scopes.push(scope);
        return () => scope.release();
      }, [authority]);
      return authority;
    }, { wrapper: StrictMode });
    expect(scopes).toHaveLength(2);
    expect(scopes[0]?.isRegistered()).toBe(false);
    expect(scopes[1]?.isRegistered()).toBe(true);
    unmount();
    expect(scopes[1]?.isRegistered()).toBe(false);
  });
});
