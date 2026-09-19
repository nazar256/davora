import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type FormEvent, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../../test/accounts";
import { createDeferred } from "../../../../test/primitives";
import { createAccountRegistryService, type AccountRegistryStorage } from "../../registry";
import type { RegistryRemovalOutcome, SemanticAccountRemovalPorts } from "../../registry";
import { executeConnectAccount } from "../../connect/controller";
import { createEmptyAccountForm, shouldEnsureSessionAfterConnect, type AccountFormState } from "../../connect/model";
import { useConnectAccount, type UseConnectAccountInput } from "../../connect/useConnectAccount";
import { executeSessionTerminalReset } from "../../reset/controller";
import type { SemanticAccountResetPorts } from "../../reset/ports";
import { useRemoveAccount, type UseRemoveAccountInput } from "../../remove/useRemoveAccount";
import { executeRemoveAccount } from "../../remove/controller";
import { useAccountActionsWorkspace } from "./useAccountActionsWorkspace";
import type { AccountActionsWorkspaceInput } from "./ports";
import { createBrowserAppServices } from "../../../../app/createBrowserAppServices";

/* These characterization fixtures intentionally bridge DOM events and Vitest's dynamic matchers. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-type-assertion */

const source = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../../../../App.tsx");
const factorySource = source("../../../../app/createBrowserAppServices.ts");

const storage = (initial: string | null = null): AccountRegistryStorage & { value: string | null } => ({
  value: initial,
  readItem: vi.fn(function (this: { value: string | null }) { return { ok: true as const, value: this.value }; }),
  writeItem: vi.fn(function (this: { value: string | null }, _key: string, value: string) { this.value = value; return { ok: true as const, value: undefined }; }),
  deleteItem: vi.fn(function (this: { value: string | null }) { this.value = null; return { ok: true as const, value: undefined }; })
});

const removalPorts = (overrides: Partial<SemanticAccountRemovalPorts> = {}): SemanticAccountRemovalPorts => ({
  quiesceAccount: vi.fn(async () => undefined),
  revokeRemoteAccount: vi.fn(async () => undefined),
  purgeLocalAccountData: vi.fn(async () => undefined),
  ...overrides
});

function connectInput(overrides: Partial<UseConnectAccountInput> = {}): UseConnectAccountInput {
  return {
    healthRootPath: ".davora-agent-test",
    unlockRequired: true,
    activeRecord: undefined,
    ports: {
      connectAccount: vi.fn(async () => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: "alpha" }, account: buildAccount("alpha") })),
      ensureSessionForAccount: vi.fn(async () => undefined)
    },
    openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
    onStatusChange: vi.fn(),
    ...overrides
  };
}

const formWithPassword = (password: string): AccountFormState => ({
  ...createEmptyAccountForm("add"),
  baseUrl: "https://cloud.example.com",
  username: "alice",
  appPassword: password
});

function workspaceInput(overrides: Partial<AccountActionsWorkspaceInput> = {}): AccountActionsWorkspaceInput {
  return {
    activeRecord: undefined,
    activeAccount: undefined,
    removeActiveAccount: undefined,
    healthRootPath: ".davora-agent-test",
    unlockRequired: false,
    settingsOpen: false,
    connect: {
      ports: { connectAccount: vi.fn(), ensureSessionForAccount: vi.fn() },
      onStatusChange: vi.fn()
    },
    remove: {
      command: {
        registry: {
          removeAccount: async () => ({ kind: "failed" as const, message: "unused" }),
          retryRemovalCommit: () => ({ kind: "failed" as const, message: "unused" })
        },
        runtime: {
          revokeRemoteAccount: vi.fn(async () => undefined),
          purgeLocalAccountData: vi.fn(async () => undefined)
        },
        knownAccounts: [],
        quiesceAccount: vi.fn(async () => undefined)
      },
      onStatusChange: vi.fn()
    },
    reset: {
      ports: {
        preview: { clearAccountContext: vi.fn() },
        selection: { clearFocused: vi.fn(), clearBatch: vi.fn() },
        browsing: { clearQuery: vi.fn(), clearListError: vi.fn() },
        navigation: { getLocationSearch: () => "", setPath: vi.fn(), syncPath: vi.fn(), closeMobileDetails: vi.fn() },
        transfers: { failActiveForAccount: vi.fn() },
        session: { applyTerminal: vi.fn() },
        bootstrap: { setError: vi.fn() },
        presentation: { setStatus: vi.fn() }
      }
    },
    navigation: { pushAccountSurface: vi.fn(), pushRemoveAccountSurface: vi.fn(), closeSettings: vi.fn() },
    switchActive: vi.fn(),
    ...overrides
  };
}

describe("Phase 4B account-actions current behavior", () => {
  it("projects complete bootstrap/dialog/remove stages and one authoritative busy snapshot", () => {
    const { result } = renderHook(() => useAccountActionsWorkspace(workspaceInput({ settingsOpen: true })));

    expect(result.current.stages.bootstrapConnect).toEqual(expect.objectContaining({ variant: expect.any(String), form: expect.any(Object) }));
    expect(result.current.stages.connectDialog).toEqual(expect.objectContaining({ open: expect.any(Boolean), busy: false }));
    expect(result.current.stages.removeDialog).toEqual(expect.objectContaining({ open: false, busy: false, accountLabel: "" }));
    expect(result.current.snapshot).toEqual({ surface: "settings", connect: { busy: false }, remove: { busy: false } });
    expect(result.current.commands).not.toHaveProperty("setShowAccountDialog");
  });

  it("keeps add/reconnect health-root and unlock inputs explicit", () => {
    const account = buildAccount("alpha", { connectionState: "reconnect_required", rootPath: "/Stored" });
    const { result } = renderHook(() => useAccountActionsWorkspace(workspaceInput({
      activeRecord: { account },
      healthRootPath: ".davora-agent-test",
      unlockRequired: true
    })));

    expect(result.current.stages.bootstrapConnect).toMatchObject({
      variant: "reconnect",
      form: { baseUrl: account.baseUrl, username: account.username, rootPath: account.rootPath, appPassword: "" }
    });
    expect(result.current.stages.connectDialog).toMatchObject({ variant: "add", open: false });

    expect(shouldEnsureSessionAfterConnect(true)).toBe(false);
    expect(shouldEnsureSessionAfterConnect(false)).toBe(true);
  });

  it("contains request-only credentials in connect outcomes", async () => {
    const sentinel = "password-account-actions-sentinel";
    const outcome = await executeConnectAccount({
      connectAccount: vi.fn(async () => { throw new Error(`raw failure ${sentinel}`); }),
      ensureSessionForAccount: vi.fn()
    }, {
      form: {
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: sentinel
      }
    });

    expect(outcome).toEqual({ kind: "failure", message: "Unable to connect account.", clearCredential: false });
    expect(JSON.stringify(outcome)).not.toContain(sentinel);
  });

  it("retains registry removal order and persists a revoke-pending phase across service recreation", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const first = createAccountRegistryService(store);
    first.commitConnectedAccount(alpha);
    const firstPorts = removalPorts({ revokeRemoteAccount: vi.fn(async () => { throw new Error("remote-sentinel"); }) });
    await expect(first.removeAccount(alpha.id, firstPorts)).resolves.toMatchObject({ kind: "pending", phase: "revoke" });
    expect(firstPorts.quiesceAccount).toHaveBeenCalledTimes(1);
    expect(firstPorts.purgeLocalAccountData).not.toHaveBeenCalled();

    const second = createAccountRegistryService(store);
    const order: string[] = [];
    const secondPorts = removalPorts({
      quiesceAccount: vi.fn(async () => { order.push("quiesce"); }),
      revokeRemoteAccount: vi.fn(async () => { order.push("revoke"); }),
      purgeLocalAccountData: vi.fn(async () => { order.push("purge"); })
    });
    await expect(second.removeAccount(alpha.id, secondPorts)).resolves.toMatchObject({ kind: "committed" });
    expect(order).toEqual(["quiesce", "revoke", "purge"]);
    expect(second.getSnapshot().accounts).toEqual([]);
  });

  it("retries persisted purge without repeating remote revoke and commits only after purge", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const first = createAccountRegistryService(store);
    first.commitConnectedAccount(alpha);
    const purge = vi.fn(async () => { throw new Error("purge-sentinel"); });
    await expect(first.removeAccount(alpha.id, removalPorts({ purgeLocalAccountData: purge }))).resolves.toMatchObject({ kind: "pending", phase: "purge" });

    const second = createAccountRegistryService(store);
    const retryPorts = removalPorts({ purgeLocalAccountData: vi.fn(async () => undefined), revokeRemoteAccount: vi.fn(async () => undefined) });
    await expect(second.removeAccount(alpha.id, retryPorts)).resolves.toMatchObject({ kind: "committed" });
    expect(retryPorts.revokeRemoteAccount).not.toHaveBeenCalled();
    expect(retryPorts.purgeLocalAccountData).toHaveBeenCalledWith(alpha);
    expect(second.getSnapshot().accounts).toEqual([]);
  });

  it("keeps duplicate removal submission inert while the registry operation is busy", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    const deferred = createDeferred<void>();
    const ports = removalPorts({ revokeRemoteAccount: vi.fn(() => deferred.promise) });
    const first = service.removeAccount(alpha.id, ports);
    const duplicate = service.removeAccount(alpha.id, ports);
    await expect(duplicate).resolves.toMatchObject({ kind: "failed" });
    deferred.resolve();
    await expect(first).resolves.toMatchObject({ kind: "committed" });
    expect(ports.quiesceAccount).toHaveBeenCalledTimes(1);
    expect(ports.revokeRemoteAccount).toHaveBeenCalledTimes(1);
  });

  it("preserves exact terminal reset fan-out order and account target", () => {
    const order: string[] = [];
    const ports: SemanticAccountResetPorts = {
      preview: { clearAccountContext: () => order.push("preview") },
      selection: { clearFocused: () => order.push("focused"), clearBatch: () => order.push("batch") },
      browsing: { clearQuery: () => order.push("query"), clearListError: () => order.push("list-error") },
      navigation: { getLocationSearch: () => "", setPath: vi.fn(), syncPath: vi.fn(), closeMobileDetails: () => order.push("details") },
      transfers: { failActiveForAccount: (id) => { order.push(`transfers:${id}`); } },
      session: { applyTerminal: (id) => { order.push(`session:${id}`); } },
      bootstrap: { setError: () => order.push("bootstrap") },
      presentation: { setStatus: () => order.push("status") }
    };

    executeSessionTerminalReset(ports, { accountId: "alpha", message: "Session expired.", reconnectRequired: true });
    expect(order).toEqual(["preview", "focused", "batch", "details", "list-error", "session:alpha", "transfers:alpha", "bootstrap", "status"]);
    expect(order).not.toContain("query");
  });

  it("keeps removal completion inert after Alpha to Beta to Alpha replacement", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const beta = buildAccount("beta", { displayName: "Beta" });
    const delayedRevoke = createDeferred<void>();
    const delayedPurge = createDeferred<void>();
    const onStatusChange = vi.fn();
    const input: UseRemoveAccountInput = {
      activeAccount: alpha,
      ports: { removeAccount: vi.fn(async () => {
        await delayedRevoke.promise;
        await delayedPurge.promise;
        return { kind: "committed" as const, snapshot: { accounts: [{ account: alpha }] } };
      }) },
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    };
    const { result, rerender } = renderHook((props: UseRemoveAccountInput) => useRemoveAccount(props), { initialProps: input });
    act(() => { result.current.setTarget(alpha); result.current.setConfirmation("Alpha"); });
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => { void result.current.confirmRemoveAccount(submit as unknown as FormEvent<HTMLFormElement>); });
    rerender({ ...input, activeAccount: beta });
    rerender({ ...input, activeAccount: alpha });
    delayedRevoke.resolve();
    await act(async () => { await delayedRevoke.promise; });
    delayedPurge.resolve();
    await act(async () => { await delayedPurge.promise; });

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(result.current.target).toEqual(alpha);
    expect(result.current.busy).toBe(false);
  });

  it("keeps delayed revoke/purge failure inert after same-id Alpha replacement", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const replacementAlpha = buildAccount("alpha", { displayName: "Recreated Alpha" });
    const delayedRevoke = createDeferred<void>();
    const delayedPurge = createDeferred<void>();
    const onStatusChange = vi.fn();
    const removeAccount = vi.fn(async () => {
      await delayedRevoke.promise;
      await delayedPurge.promise;
      return {
        kind: "pending" as const,
        phase: "purge" as const,
        snapshot: { accounts: [{ account: replacementAlpha }] },
        message: "Remote access was revoked, but browser cleanup did not complete. Retry to continue."
      };
    });
    const input: UseRemoveAccountInput = {
      activeAccount: alpha,
      ports: { removeAccount },
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    };
    const { result, rerender } = renderHook((props: UseRemoveAccountInput) => useRemoveAccount(props), { initialProps: input });
    act(() => { result.current.setTarget(alpha); result.current.setConfirmation("Alpha"); });
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => { void result.current.confirmRemoveAccount(submit as unknown as FormEvent<HTMLFormElement>); });
    rerender({ ...input, activeAccount: buildAccount("beta") });
    rerender({ ...input, activeAccount: replacementAlpha });
    delayedRevoke.resolve();
    delayedPurge.resolve();
    await act(async () => { await delayedPurge.promise; });

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(result.current.target).toEqual(alpha);
    expect(result.current.error).toBeUndefined();
    expect(JSON.stringify(result.current)).not.toContain("Recreated Alpha");
  });

  it("maps connect credential clearing explicitly across success, partial failure, replacement, and unmount", async () => {
    const sentinel = "connect-password-account-actions-sentinel";
    const committed = { kind: "committed" as const, snapshot: { accounts: [], activeAccountId: "alpha" }, account: buildAccount("alpha") };
    const successInput = connectInput({ ports: { connectAccount: vi.fn(async () => committed), ensureSessionForAccount: vi.fn() } });
    const success = renderHook(() => useConnectAccount(successInput));
    act(() => { success.result.current.setForm(formWithPassword(sentinel)); success.result.current.setShowDialog(true); });
    await act(async () => { void success.result.current.submitAccountForm(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(success.result.current.form.appPassword).toBe(""));
    expect(successInput.onStatusChange).toHaveBeenCalledWith("Connected account Account alpha");

    const partialInput = connectInput({ ports: {
      connectAccount: vi.fn(async () => ({ kind: "partial" as const, message: "The account connected remotely, but could not be saved in this browser.", clearCredential: true as const })),
      ensureSessionForAccount: vi.fn()
    } });
    const partial = renderHook(() => useConnectAccount(partialInput));
    act(() => { partial.result.current.setForm(formWithPassword(sentinel)); partial.result.current.setShowDialog(true); });
    await act(async () => { void partial.result.current.submitAccountForm(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(partial.result.current.form.appPassword).toBe(""));
    expect(partial.result.current.formError).toContain("could not be saved");

    const failureInput = connectInput({ ports: {
      connectAccount: vi.fn(async () => { throw new Error(`raw failure ${sentinel}`); }),
      ensureSessionForAccount: vi.fn()
    } });
    const failure = renderHook(() => useConnectAccount(failureInput));
    act(() => { failure.result.current.setForm(formWithPassword(sentinel)); failure.result.current.setShowDialog(true); });
    await act(async () => { void failure.result.current.submitAccountForm(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(failure.result.current.formError).toBe("Unable to connect account."));
    // Current invariant: raw/retryable failure retains the request form credential.
    expect(failure.result.current.form.appPassword).toBe(sentinel);

    const delayed = createDeferred<Awaited<ReturnType<typeof successInput.ports.connectAccount>>>();
    const replacementInput = connectInput({ activeRecord: { account: buildAccount("alpha") }, ports: { connectAccount: vi.fn(() => delayed.promise), ensureSessionForAccount: vi.fn() } });
    const replacement = renderHook((props: UseConnectAccountInput) => useConnectAccount(props), { initialProps: replacementInput });
    act(() => { replacement.result.current.setForm(formWithPassword(sentinel)); replacement.result.current.setShowDialog(true); });
    act(() => { void replacement.result.current.submitAccountForm(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    replacement.rerender({ ...replacementInput, activeRecord: { account: buildAccount("beta") } });
    delayed.resolve(committed);
    await act(async () => { await delayed.promise; });
    expect(replacementInput.onStatusChange).not.toHaveBeenCalled();
    expect(replacement.result.current.form.appPassword).toBe(sentinel);

    const unmountDelayed = createDeferred<Awaited<ReturnType<typeof successInput.ports.connectAccount>>>();
    const unmountInput = connectInput({ ports: { connectAccount: vi.fn(() => unmountDelayed.promise), ensureSessionForAccount: vi.fn() } });
    const unmounted = renderHook(() => useConnectAccount(unmountInput));
    act(() => { unmounted.result.current.setForm(formWithPassword(sentinel)); unmounted.result.current.setShowDialog(true); });
    act(() => { void unmounted.result.current.submitAccountForm(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    unmounted.unmount();
    unmountDelayed.resolve(committed);
    await act(async () => { await unmountDelayed.promise; });
    expect(unmountInput.onStatusChange).not.toHaveBeenCalled();
  });

  it("ignores delayed removal completion after StrictMode unmount", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const deferred = createDeferred<RegistryRemovalOutcome>();
    const onStatusChange = vi.fn();
    const input: UseRemoveAccountInput = {
      activeAccount: alpha,
      ports: { removeAccount: vi.fn(() => deferred.promise) },
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result, unmount } = renderHook((props: UseRemoveAccountInput) => useRemoveAccount(props), { initialProps: input, wrapper });
    act(() => { result.current.setTarget(alpha); result.current.setConfirmation("Alpha"); });
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    act(() => { void result.current.confirmRemoveAccount(submit as unknown as FormEvent<HTMLFormElement>); });
    unmount();
    deferred.resolve({ kind: "committed", snapshot: { accounts: [] } });
    await act(async () => { await deferred.promise; });

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("preserves no-op behavior when there is no active account", () => {
    const closeSettings = vi.fn();
    const pushRemove = vi.fn();
    const { result } = renderHook(() => useAccountActionsWorkspace(workspaceInput({
      settingsOpen: false,
      activeAccount: undefined,
      navigation: { pushAccountSurface: vi.fn(), pushRemoveAccountSurface: pushRemove, closeSettings }
    })));
    act(() => { result.current.commands.openRemoveFromSettings(); });
    expect(closeSettings).not.toHaveBeenCalled();
    expect(pushRemove).not.toHaveBeenCalled();
    expect(result.current.snapshot.surface).toBe("none");
  });

  it("keeps runtime failure sentinels out of pending outcomes, Stage/error output, storage, console, and URL", async () => {
    const alpha = buildAccount("alpha", { displayName: "Failure Alpha" });
    const sentinel = "raw-account-removal-secret-sentinel";
    const store = storage();
    const registry = createAccountRegistryService(store);
    registry.commitConnectedAccount(alpha);
    const pending = await registry.removeAccount(alpha.id, removalPorts({
      revokeRemoteAccount: vi.fn(async () => { throw new Error(sentinel); })
    }));
    expect(pending).toMatchObject({ kind: "pending", phase: "revoke", message: "Account removal could not revoke remote access. Retry to continue." });
    expect(JSON.stringify(pending)).not.toContain(sentinel);
    expect(store.value ?? "").not.toContain(sentinel);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = vi.fn();
    const port = { removeAccount: vi.fn(async () => pending) };
    const controllerOutcome = await executeRemoveAccount(port, { target: alpha, confirmation: alpha.displayName });
    expect(controllerOutcome).toEqual({ kind: "failure", message: "Account removal could not revoke remote access. Retry to continue." });
    expect(JSON.stringify(controllerOutcome)).not.toContain(sentinel);

    const { result } = renderHook(() => useRemoveAccount({
      activeAccount: alpha,
      ports: port,
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange: status
    }));
    act(() => { result.current.setTarget(alpha); result.current.setConfirmation(alpha.displayName); });
    await act(async () => { void result.current.confirmRemoveAccount(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(result.current.error).toBe("Account removal could not revoke remote access. Retry to continue."));
    expect(JSON.stringify(result.current)).not.toContain(sentinel);
    expect(status).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(sentinel);
    consoleError.mockRestore();
  });

});

describe("Phase 4B application-composition tripwires", () => {
  it("exposes one account-removal runtime from the browser factory", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 900px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
    const services = createBrowserAppServices();
    expect(services.accountRemovalRuntime).toBeDefined();
  });

  it("retires concrete account cleanup and busy-stage interpretation from App", () => {
    expect(appSource).not.toMatch(/deleteConnectedAccount|purgeAccountNamespace/);
    expect(appSource).not.toMatch(/const accountBusy/);
    expect(appSource).not.toMatch(/retryRemovalCommit/);
  });

  it("uses a complete account-owned Stage without App busy spreads", () => {
    expect(appSource).not.toMatch(/connectAccount:\s*\{\s*\.\.\.accountActionsWorkspace\.stages\.connectDialog,\s*busy:/s);
    expect(appSource).not.toMatch(/connectStage:\s*\{\s*\.\.\.accountActionsWorkspace\.stages\.bootstrapConnect,\s*busy:/s);
    expect(factorySource).toMatch(/accountRemovalRuntime/);
  });

  it("retires inline retry-token dispatch from App", () => {
    expect(appSource).not.toMatch(/retryRemovalCommit/);
  });

  it("does not submit the remove command twice while the dialog is busy", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const deferred = createDeferred<{ readonly kind: "committed"; readonly snapshot: { readonly accounts: [] } }>();
    const removeAccount = vi.fn(() => deferred.promise);
    const { result } = renderHook(() => useRemoveAccount({
      activeAccount: alpha,
      ports: { removeAccount },
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange: vi.fn()
    }));
    act(() => {
      result.current.setTarget(alpha);
      result.current.setConfirmation("Alpha");
    });
    const submitEvent = () => new Event("submit", { bubbles: true, cancelable: true }) as unknown as FormEvent<HTMLFormElement>;
    act(() => {
      void result.current.confirmRemoveAccount(submitEvent());
      void result.current.confirmRemoveAccount(submitEvent());
    });
    expect(removeAccount).toHaveBeenCalledTimes(1);
    deferred.resolve({ kind: "committed", snapshot: { accounts: [] } });
    await act(async () => { await deferred.promise; });
  });

  it("releases busy ownership when a public remove dismissal invalidates deferred work", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const first = createDeferred<RegistryRemovalOutcome>();
    const second = createDeferred<RegistryRemovalOutcome>();
    const removeAccount = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const status = vi.fn();
    const { result } = renderHook(() => useAccountActionsWorkspace(workspaceInput({
      activeAccount: alpha,
      remove: {
        command: {
          registry: {
            removeAccount,
            retryRemovalCommit: () => ({ kind: "failed" as const, message: "unused" })
          },
          runtime: {
            revokeRemoteAccount: vi.fn(async () => undefined),
            purgeLocalAccountData: vi.fn(async () => undefined)
          },
          knownAccounts: [alpha],
          quiesceAccount: vi.fn(async () => undefined)
        },
        onStatusChange: status
      }
    })));

    act(() => { result.current.commands.openRemoveFromSettings(); });
    act(() => { result.current.stages.removeDialog.onConfirmationChange("Alpha"); });
    act(() => { result.current.stages.removeDialog.onSubmit(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(result.current.snapshot.remove.busy).toBe(true));

    act(() => { result.current.stages.removeDialog.onClose(); });
    expect(result.current.snapshot.remove.busy).toBe(false);
    expect(result.current.stages.removeDialog.open).toBe(false);
    first.resolve({ kind: "committed", snapshot: { accounts: [] } });
    await act(async () => { await first.promise; });
    expect(status).not.toHaveBeenCalled();

    act(() => { result.current.commands.openRemoveFromSettings(); });
    expect(result.current.stages.removeDialog.busy).toBe(false);
    act(() => { result.current.stages.removeDialog.onConfirmationChange("Alpha"); });
    act(() => { result.current.stages.removeDialog.onSubmit(new Event("submit") as unknown as FormEvent<HTMLFormElement>); });
    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(2));
    second.resolve({ kind: "failed", message: "Account removal could not revoke remote access. Retry to continue." });
    await act(async () => { await second.promise; });
  });
});
