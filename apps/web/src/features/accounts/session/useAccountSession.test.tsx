// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HealthResponse } from "@davora/shared";

import { ApiRequestError } from "../../../lib/api";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import type { AccountSessionPorts } from "./ports";
import { useAccountSession, type AccountSessionController, type UseAccountSessionInput } from "./useAccountSession";

const createPorts = (overrides: Partial<AccountSessionPorts> = {}): AccountSessionPorts => ({
  getHealth: vi.fn(async () => buildHealthResponse()),
  createSession: vi.fn(async ({ accountId }: { accountId: string; unlockCode?: string }) => buildSession(buildAccount(accountId))),
  commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: undefined } })),
  markAccountReconnectRequired: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
  clearAccountSession: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
  delay: vi.fn(async () => undefined),
  ...overrides
});

function renderAccountSession(initialProps: UseAccountSessionInput) {
  return renderHook<AccountSessionController, UseAccountSessionInput>(
    (input) => useAccountSession(input),
    { initialProps }
  );
}

describe("useAccountSession", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  it("skips health load and auto-restore in explicit offline mode", async () => {
    const account = buildAccount("alpha");
    const ports = createPorts();

    const { result } = renderHook(() => useAccountSession({
      explicitOfflineMode: true,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange: vi.fn()
    }));

    await waitFor(() => expect(result.current.healthLoading).toBe(false));
    expect(ports.getHealth).not.toHaveBeenCalled();
    expect(ports.createSession).not.toHaveBeenCalled();
    expect(result.current.bootstrapError).toBeUndefined();
    expect(result.current.healthRootPath).toBe(".davora-agent-test");
  });

  it("keeps session work available through StrictMode effect replay", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const ports = createPorts();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

    renderHook(() => useAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange: vi.fn()
    }), { wrapper });

    await waitFor(() => expect(ports.getHealth).toHaveBeenCalled());
    await waitFor(() => expect(ports.createSession).toHaveBeenCalled());
  });

  it("captures health rootPath for account-form defaults and ignores superseded loads", async () => {
    let releaseHealth: ((value: HealthResponse) => void) | undefined;
    const ports = createPorts({
      getHealth: vi.fn((): Promise<HealthResponse> => new Promise((resolve) => {
        releaseHealth = resolve;
      }))
    });

    const { result, rerender, unmount } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      ports,
      onStatusChange: vi.fn()
    });

    expect(result.current.healthLoading).toBe(true);

    const supersededPorts = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ rootPath: "workspace-root" }))
    });
    rerender({
      explicitOfflineMode: false,
      offline: false,
      ports: supersededPorts,
      onStatusChange: vi.fn()
    });

    releaseHealth?.(buildHealthResponse({ rootPath: "stale-root", unlockRequired: true }));
    await waitFor(() => expect(result.current.healthLoading).toBe(false));
    expect(result.current.healthRootPath).toBe("workspace-root");
    expect(result.current.unlockRequired).toBe(false);

    unmount();
  });

  it("auto-restores when gates are open and pauses after auto failures", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", connectionState: "reconnect_required" });
    const ports = createPorts({
      createSession: vi
        .fn()
        .mockRejectedValueOnce(new ApiRequestError("reconnect", 409, "account_reconnect_required"))
        .mockResolvedValueOnce(buildSession(account))
    });
    const onStatusChange = vi.fn();

    const { result } = renderHook(() => useAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange
    }));

    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));
    expect(result.current.autoRestorePausedForAccountId).toBe(account.id);

    await act(async () => {
      await result.current.ensureSessionForAccount(account.id, undefined, "manual");
    });

    expect(ports.createSession).toHaveBeenCalledTimes(2);
    expect(result.current.autoRestorePausedForAccountId).toBeUndefined();
    expect(onStatusChange).toHaveBeenCalledWith("Restored workspace access for Alpha workspace");
  });

  it("does not auto-restore while a token, unlock requirement, or offline gate is active", async () => {
    const account = buildAccount("alpha");
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true }))
    });

    const { result, rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      token: "token-alpha",
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(result.current.healthLoading).toBe(false));
    expect(ports.createSession).not.toHaveBeenCalled();

    rerender({
      explicitOfflineMode: false,
      offline: true,
      activeAccount: account,
      token: undefined,
      ports,
      onStatusChange: vi.fn()
    });
    expect(ports.createSession).not.toHaveBeenCalled();

    rerender({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      token: undefined,
      ports: createPorts(),
      onStatusChange: vi.fn()
    });
    await waitFor(() => expect(result.current.unlockRequired).toBe(true));
    expect(ports.createSession).not.toHaveBeenCalled();
  });

  it("refreshes account state and clears pause on ensure success", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const session = buildSession(account);
    const nextState = { accounts: [{ account, session }], activeAccountId: account.id };
    const ports = createPorts({
      createSession: vi.fn(async () => session),
      commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: nextState }))
    });

    const { result, rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(result.current.healthLoading).toBe(false));
    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));

    expect(result.current.autoRestorePausedForAccountId).toBeUndefined();
    expect(result.current.workerUnavailable).toBe(false);

    rerender({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      token: session.token,
      ports,
      onStatusChange: vi.fn()
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(ports.createSession).toHaveBeenCalledTimes(1);
  });

  it("drops an immediate restore completion when explicit offline mode starts", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const session = buildSession(account);
    const restore = deferred<typeof session>();
    const onStatusChange = vi.fn();
    const commitSession = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: account.id } }));
    const ports = createPorts({ createSession: vi.fn(() => restore.promise), commitSession });
    const { result, rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange
    });

    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));
    rerender({ explicitOfflineMode: true, offline: false, activeAccount: account, ports,  onStatusChange });
    restore.resolve(session);
    await act(async () => await Promise.resolve());

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(commitSession).not.toHaveBeenCalled();
    expect(result.current.lifecycle.kind).toBe("skipped");
  });

  it("drops a late restore completion after unmount before commit", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const session = buildSession(account);
    const restore = deferred<typeof session>();
    const commitSession = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: account.id } }));
    const onStatusChange = vi.fn();
    const ports = createPorts({ createSession: vi.fn(() => restore.promise), commitSession });
    const { unmount } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange
    });

    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));
    unmount();
    restore.resolve(session);
    await act(async () => undefined);

    expect(commitSession).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("drops a retry-delayed restore before the next attempt when offline starts", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const delay = deferred<void>();
    const ports = createPorts({
      createSession: vi.fn().mockRejectedValue(new ApiRequestError("temporary", 503)),
      delay: vi.fn(() => delay.promise)
    });
    const onStatusChange = vi.fn();
    const { rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange
    });

    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));
    rerender({ explicitOfflineMode: true, offline: false, activeAccount: account, ports, onStatusChange });
    delay.resolve();
    await act(async () => await Promise.resolve());

    expect(ports.createSession).toHaveBeenCalledTimes(1);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("does not let an online account restore bleed into a switched persisted-offline account", async () => {
    const alpha = buildAccount("alpha", { connectionState: "reconnect_required" });
    const beta = buildAccount("beta", { connectionState: "reconnect_required" });
    const restore = deferred<ReturnType<typeof buildSession>>();
    const commitSession = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: alpha.id } }));
    const ports = createPorts({ createSession: vi.fn(() => restore.promise), commitSession });
    const { rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: alpha,
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(ports.createSession).toHaveBeenCalledWith({ accountId: alpha.id }));
    rerender({ explicitOfflineMode: true, offline: false, activeAccount: beta, ports,  onStatusChange: vi.fn() });
    restore.resolve(buildSession(alpha));
    await act(async () => await Promise.resolve());

    expect(ports.createSession).toHaveBeenCalledTimes(1);
    expect(commitSession).not.toHaveBeenCalled();
  });

  it("waits for fresh health readiness before restoring after explicit offline mode ends", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const health = deferred<HealthResponse>();
    const ports = createPorts({ getHealth: vi.fn(() => health.promise) });
    const { result, rerender } = renderAccountSession({
      explicitOfflineMode: true,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange: vi.fn()
    });

    expect(ports.getHealth).not.toHaveBeenCalled();
    rerender({ explicitOfflineMode: false, offline: false, activeAccount: account, ports, onStatusChange: vi.fn() });
    await waitFor(() => expect(ports.getHealth).toHaveBeenCalledTimes(1));
    expect(ports.createSession).not.toHaveBeenCalled();

    health.resolve(buildHealthResponse());
    await waitFor(() => expect(ports.createSession).toHaveBeenCalledTimes(1));
    expect(result.current.healthLoading).toBe(false);
  });

  it("lets a current Beta restore start while stale Alpha retry delay unwinds", async () => {
    const alpha = buildAccount("alpha", { connectionState: "reconnect_required" });
    const beta = buildAccount("beta", { connectionState: "reconnect_required" });
    const alphaDelay = deferred<void>();
    const createSession = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError("temporary", 503))
      .mockResolvedValueOnce(buildSession(beta));
    const ports = createPorts({
      createSession,
      delay: vi.fn(() => alphaDelay.promise)
    });
    const { rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: alpha,
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    rerender({ explicitOfflineMode: true, offline: false, activeAccount: beta, ports, onStatusChange: vi.fn() });
    rerender({ explicitOfflineMode: false, offline: false, activeAccount: beta, ports, onStatusChange: vi.fn() });

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(createSession).toHaveBeenLastCalledWith({ accountId: beta.id });
    alphaDelay.resolve();
    await act(async () => await Promise.resolve());
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("allows a fresh same-account restore after a rapid offline enter and exit", async () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required" });
    const staleDelay = deferred<void>();
    const createSession = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError("temporary", 503))
      .mockResolvedValueOnce(buildSession(account));
    const ports = createPorts({
      createSession,
      delay: vi.fn(() => staleDelay.promise)
    });
    const { rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: account,
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    rerender({ explicitOfflineMode: true, offline: false, activeAccount: account, ports, onStatusChange: vi.fn() });
    rerender({ explicitOfflineMode: false, offline: false, activeAccount: account, ports, onStatusChange: vi.fn() });

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    staleDelay.resolve();
    await act(async () => await Promise.resolve());
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("resets a direct online account switch out of stale restoring lifecycle", async () => {
    const alpha = buildAccount("alpha", { connectionState: "reconnect_required" });
    const beta = buildAccount("beta", { connectionState: "reconnect_required" });
    const alphaRestore = deferred<ReturnType<typeof buildSession>>();
    const createSession = vi.fn()
      .mockImplementationOnce(() => alphaRestore.promise)
      .mockResolvedValueOnce(buildSession(beta));
    const ports = createPorts({ createSession });
    const { rerender } = renderAccountSession({
      explicitOfflineMode: false,
      offline: false,
      activeAccount: alpha,
      ports,
      onStatusChange: vi.fn()
    });

    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: alpha.id }));
    rerender({ explicitOfflineMode: false, offline: false, activeAccount: beta, ports, onStatusChange: vi.fn() });

    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: beta.id }));
    alphaRestore.resolve(buildSession(alpha));
    await act(async () => await Promise.resolve());
    expect(createSession).toHaveBeenCalledTimes(2);
  });
});
