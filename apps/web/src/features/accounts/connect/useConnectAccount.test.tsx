import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyAccountForm } from "./model";
import { buildAccount } from "../../../test/accounts";
import { createAccountRegistryService, type AccountRegistryStorage } from "../registry";
import { createBrowserAccountTransport } from "../../../platform/api/browserAccountTransport";
import { createBrowserOwnershipEnvironmentPort } from "../../../platform/security/browserOwnershipEnvironmentPort";
import { createBrowserOwnershipStoragePort } from "../../../platform/security/browserOwnershipStoragePort";
import { createBrowserStringStorage } from "../../../platform/storage/browserStringStorage";
import { createBrowserOwnershipIdentityService } from "../ownership";
import type { ConnectAccountPorts } from "./ports";
import { ConnectAccountDialogStage } from "./ConnectAccountDialogStage";
import { useConnectAccount, type UseConnectAccountInput } from "./useConnectAccount";
import { createDeferred } from "../../../test/primitives";

const createPorts = (overrides: Partial<ConnectAccountPorts> = {}): ConnectAccountPorts => ({
  connectAccount: vi.fn(async () => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: "alpha" }, account: buildAccount("alpha", { displayName: "Alpha workspace" }) })),
  ensureSessionForAccount: vi.fn(async () => undefined),
  ...overrides
});

const connectAccountTransport = createBrowserAccountTransport(createBrowserOwnershipIdentityService({
  storage: createBrowserOwnershipStoragePort(createBrowserStringStorage()),
  environment: createBrowserOwnershipEnvironmentPort()
})).connectAccount;

const renderConnectAccount = (input: UseConnectAccountInput) => renderHook(
  (props) => useConnectAccount(props),
  { initialProps: input }
);

async function runSubmit(handler: (event: FormEvent<HTMLFormElement>) => void | Promise<void>) {
  const view = render(<form data-testid="submit-form" onSubmit={(event) => { void handler(event); }} />);
  const form = view.container.querySelector("form");
  if (!form) {
    throw new Error("submit form is unavailable");
  }
  await act(async () => {
    fireEvent.submit(form);
  });
  view.unmount();
}

function startSubmit(handler: (event: FormEvent<HTMLFormElement>) => void | Promise<void>) {
  const view = render(<form data-testid="submit-form" onSubmit={(event) => { void handler(event); }} />);
  const form = view.container.querySelector("form");
  if (!form) {
    throw new Error("submit form is unavailable");
  }
  act(() => {
    fireEvent.submit(form);
  });
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useConnectAccount", () => {
  it("opens add-account dialog with health root defaults", async () => {
    const pushAccountSurface = vi.fn();
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts(),
      openerPorts: {
        pushAccountSurface,
        closeSettings: vi.fn()
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.openAddAccountDialog();
    });

    expect(pushAccountSurface).toHaveBeenCalledTimes(1);
    expect(result.current.showDialog).toBe(true);
    expect(result.current.form).toEqual(createEmptyAccountForm("add", ".davora-agent-test"));
  });

  it("projects reconnect bootstrap bindings without requiring the shell to build a form", () => {
    const activeRecord = {
      account: buildAccount("alpha", {
        baseUrl: "https://stored.example.com",
        connectionState: "reconnect_required",
        displayName: "Alpha workspace",
        rootPath: "/Projects",
        username: "alpha-user"
      })
    };
    const { result } = renderConnectAccount({
      activeRecord,
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts(),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange: vi.fn()
    });

    expect(result.current.bootstrap.variant).toBe("reconnect");
    expect(result.current.bootstrap.form).toMatchObject({
      baseUrl: "https://stored.example.com",
      username: "alpha-user",
      rootPath: "/Projects",
      appPassword: ""
    });
    expect(result.current.dialog.variant).toBe("add");
  });

  it("reveals zero-state form with an empty root path", async () => {
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts(),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.revealZeroStateForm();
    });

    expect(result.current.showZeroStateForm).toBe(true);
    expect(result.current.form.rootPath).toBe("");
  });

  it("submits a successful connect, resets form state, and updates status", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts(),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    expect(onStatusChange).toHaveBeenCalledWith("Connected account Alpha workspace");
    expect(result.current.showDialog).toBe(false);
    expect(result.current.showZeroStateForm).toBe(false);
    expect(result.current.form).toEqual(createEmptyAccountForm("add", ".davora-agent-test"));
  });

  it("activates newly added B and closes the add-account modal only after the committed outcome", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    let stored: string | null = null;
    const registry = createAccountRegistryService({
      readItem: () => ({ ok: true as const, value: stored }),
      writeItem: (_key, value) => { stored = value; return { ok: true as const, value: undefined }; },
      deleteItem: () => { stored = null; return { ok: true as const, value: undefined }; }
    });
    expect(registry.commitConnectedAccount(alpha)).toMatchObject({ kind: "committed" });
    const onStatusChange = vi.fn();
    const ensureSessionForAccount = vi.fn(async () => undefined);
    const { result } = renderConnectAccount({
      activeRecord: { account: alpha },
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: {
        connectAccount: (request) => registry.connectAccount(request, vi.fn(async () => ({ kind: "http-success" as const, data: { account: beta } }))),
        ensureSessionForAccount
      },
      openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
      onStatusChange
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: beta.baseUrl,
        username: beta.username,
        appPassword: "beta-password"
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    expect(registry.getSnapshot().activeAccountId).toBe(beta.id);
    expect(result.current.showDialog).toBe(false);
    expect(onStatusChange).toHaveBeenCalledWith("Connected account Beta workspace");
  });

  it("makes a replaced connect attempt inert, including StrictMode replay", async () => {
    const pending = createDeferred<Awaited<ReturnType<ConnectAccountPorts["connectAccount"]>>>();
    const onStatusChange = vi.fn();
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    const connectAccount = vi.fn(() => pending.promise);
    const input: UseConnectAccountInput = {
      activeRecord: { account: alpha },
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({ connectAccount }),
      openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
      onStatusChange
    };
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, rerender } = renderHook((props: UseConnectAccountInput) => useConnectAccount(props), {
      initialProps: input,
      wrapper
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      });
      result.current.setShowDialog(true);
    });
    const submitView = startSubmit((event) => result.current.submitAccountForm(event));
    await waitFor(() => expect(connectAccount).toHaveBeenCalledTimes(1));

    rerender({ ...input, activeRecord: { account: beta } });
    expect(result.current.busy).toBe(false);
    pending.resolve({
      kind: "committed",
      snapshot: { accounts: [], activeAccountId: alpha.id },
      account: alpha
    });
    await act(async () => { await pending.promise; });

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(result.current.showDialog).toBe(true);
    submitView.unmount();
  });

  it("does not publish a connect completion after unmount", async () => {
    const pending = createDeferred<Awaited<ReturnType<ConnectAccountPorts["connectAccount"]>>>();
    const onStatusChange = vi.fn();
    const connectAccount = vi.fn(() => pending.promise);
    const input: UseConnectAccountInput = {
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({ connectAccount }),
      openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
      onStatusChange
    };
    const { result, unmount } = renderConnectAccount(input);

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      });
      result.current.setShowDialog(true);
    });
    const submitView = startSubmit((event) => result.current.submitAccountForm(event));
    await waitFor(() => expect(connectAccount).toHaveBeenCalledTimes(1));
    unmount();

    pending.resolve({
      kind: "committed",
      snapshot: { accounts: [], activeAccountId: "alpha" },
      account: buildAccount("alpha", { displayName: "Alpha workspace" })
    });
    await act(async () => { await pending.promise; });
    expect(onStatusChange).not.toHaveBeenCalled();
    submitView.unmount();
  });

  it("retains the form and reports validation without calling the connect port", async () => {
    const connectAccount = vi.fn();
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({ connectAccount }),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange: vi.fn()
    });
    const invalidForm = {
      ...createEmptyAccountForm("add"),
      baseUrl: "https://cloud.example.com"
    };

    act(() => {
      result.current.setForm(invalidForm);
      result.current.setShowDialog(true);
    });
    await runSubmit((event) => result.current.submitAccountForm(event));

    expect(connectAccount).not.toHaveBeenCalled();
    expect(result.current.form).toEqual(invalidForm);
    expect(result.current.dialog.open).toBe(true);
    expect(result.current.dialog.error).toBe("Base URL, username, and app password are required.");
  });

  it("passes a sentinel password only to connect and never to status-like callbacks", async () => {
    const sentinelPassword = "sentinel-password-never-leaks";
    const connectAccount = vi.fn(async (request: { appPassword: string }) => {
      expect(request.appPassword).toBe(sentinelPassword);
      return { kind: "committed" as const, snapshot: { accounts: [], activeAccountId: "alpha" }, account: buildAccount("alpha", { displayName: "Alpha workspace" }) };
    });
    const onStatusChange = vi.fn();
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: true,
      ports: createPorts({ connectAccount }),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: sentinelPassword
      });
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    await waitFor(() => expect(connectAccount).toHaveBeenCalledTimes(1));
    expect(onStatusChange).toHaveBeenCalledWith("Connected account Alpha workspace");
    expect(onStatusChange.mock.calls.flat()).not.toContain(sentinelPassword);
    expect(result.current.form.appPassword).toBe("");
  });

  it("does not project credential-bearing adapter errors into the dialog", async () => {
    const sentinelPassword = "sentinel-password-never-rendered-from-error";
    const onStatusChange = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({
        connectAccount: vi.fn(async () => {
          throw new Error(`Rejected request containing appPassword=${sentinelPassword}`);
        })
      }),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: sentinelPassword
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));
    await waitFor(() => expect(result.current.dialog.error).toBe("Unable to connect account."));

    const view = render(<ConnectAccountDialogStage {...result.current.dialog} />);
    expect(view.container.textContent).not.toContain(sentinelPassword);
    expect(screen.getByLabelText("App password")).toHaveValue(sentinelPassword);
    expect(localStorage.getItem("davora-account-state") ?? "").not.toContain(sentinelPassword);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toContain(sentinelPassword);
    view.unmount();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("sets connect status before ensuring session when unlock is not required", async () => {
    const callOrder: string[] = [];
    const onStatusChange = vi.fn((message: string) => {
      callOrder.push(`status:${message}`);
    });
    const ensureSessionForAccount = vi.fn(async () => {
      callOrder.push("ensure");
      return undefined;
    });
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({ ensureSessionForAccount }),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    await waitFor(() => expect(ensureSessionForAccount).toHaveBeenCalled());
    expect(callOrder).toEqual([
      "status:Connected account Alpha workspace",
      "ensure"
    ]);
  });

  it("skips ensure-session after connect when unlock is required", async () => {
    const ensureSessionForAccount = vi.fn(async () => undefined);
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: true,
      ports: createPorts({ ensureSessionForAccount }),
      openerPorts: {
        pushAccountSurface: vi.fn(),
        closeSettings: vi.fn()
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    await waitFor(() => expect(result.current.showDialog).toBe(false));
    expect(ensureSessionForAccount).not.toHaveBeenCalled();
  });

  it("clears the password and keeps the form open after remote success with local persistence failure", async () => {
    const sentinel = "partial-connect-password-sentinel";
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onStatusChange = vi.fn();
    const ensureSessionForAccount = vi.fn(async () => undefined);
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts({
        connectAccount: vi.fn(async () => ({
          kind: "partial" as const,
          message: "The account connected remotely, but could not be saved in this browser.",
          clearCredential: true as const
        })),
        ensureSessionForAccount
      }),
      openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
      onStatusChange
    });
    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: sentinel
      });
      result.current.setShowDialog(true);
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    expect(result.current.showDialog).toBe(true);
    expect(result.current.form.appPassword).toBe("");
    expect(result.current.formError).toBe("The account connected remotely, but could not be saved in this browser.");
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(ensureSessionForAccount).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current)).not.toContain(sentinel);
    const view = render(<ConnectAccountDialogStage {...result.current.dialog} />);
    expect(screen.getByLabelText("App password")).toHaveValue("");
    expect(view.container.textContent).not.toContain(sentinel);
    expect(localStorage.getItem("davora-account-state") ?? "").not.toContain(sentinel);
    expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toContain(sentinel);
    view.unmount();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it.each(["cache collision", "reconnect identity mismatch", "malformed HTTP success"] as const)(
    "clears credential sentinels from every observable sink after %s",
    async (scenario) => {
      const sentinel = `${scenario.replaceAll(" ", "-")}-password-sentinel`;
      let stored: string | null = null;
      const storage: AccountRegistryStorage = {
        readItem: vi.fn(() => ({ ok: true as const, value: stored })),
        writeItem: vi.fn((_key: string, value: string) => { stored = value; return { ok: true as const, value: undefined }; }),
        deleteItem: vi.fn(() => { stored = null; return { ok: true as const, value: undefined }; })
      };
      const registry = createAccountRegistryService(storage);
      const alpha = buildAccount("alpha");
      registry.commitConnectedAccount(alpha);
      const responseSentinel = "malformed-response-secret-sentinel";
      const returned: unknown = scenario === "cache collision"
        ? buildAccount("beta", { cacheNamespace: alpha.cacheNamespace })
        : scenario === "reconnect identity mismatch"
          ? buildAccount("other")
          : { id: "malformed", appPassword: responseSentinel };
      const onStatusChange = vi.fn();
      const ensureSessionForAccount = vi.fn(async () => undefined);
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { result } = renderConnectAccount({
        healthRootPath: ".davora-agent-test",
        unlockRequired: false,
        ports: {
          connectAccount: (request) => registry.connectAccount(request, vi.fn(async () => ({ kind: "http-success" as const, data: { account: returned } }))),
          ensureSessionForAccount
        },
        openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
        onStatusChange
      });
      act(() => {
        result.current.setForm({
          ...createEmptyAccountForm(scenario === "reconnect identity mismatch" ? "reconnect" : "add"),
          ...(scenario === "reconnect identity mismatch" ? { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace } : {}),
          baseUrl: alpha.baseUrl,
          username: alpha.username,
          appPassword: sentinel
        });
        result.current.setShowDialog(true);
      });

      await runSubmit((event) => result.current.submitAccountForm(event));

      expect(result.current.showDialog).toBe(true);
      expect(result.current.form.appPassword).toBe("");
      expect(registry.getSnapshot().accounts).toEqual([{ account: alpha }]);
      expect(stored ?? "").not.toContain(sentinel);
      expect(stored ?? "").not.toContain(responseSentinel);
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(ensureSessionForAccount).not.toHaveBeenCalled();
      const view = render(<ConnectAccountDialogStage {...result.current.dialog} />);
      expect(screen.getByLabelText("App password")).toHaveValue("");
      expect(view.container.textContent).not.toContain(sentinel);
      expect(view.container.textContent).not.toContain(responseSentinel);
      expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toMatch(new RegExp(`${sentinel}|${responseSentinel}`));
      view.unmount();
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  );

  it.each(["invalid JSON", "empty body"] as const)(
    "clears credentials after the real API adapter receives a 201 with %s",
    async (bodyKind) => {
      const requestSentinel = `${bodyKind.replaceAll(" ", "-")}-request-password-sentinel`;
      const responseSentinel = "invalid-success-response-secret-sentinel";
      const body = bodyKind === "invalid JSON" ? `{"secret":"${responseSentinel}"` : "";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 201, headers: { "content-type": "application/json" } })));
      let stored: string | null = null;
      const registry = createAccountRegistryService({
        readItem: () => ({ ok: true, value: stored }),
        writeItem: (_key, value) => { stored = value; return { ok: true, value: undefined }; },
        deleteItem: () => { stored = null; return { ok: true, value: undefined }; }
      });
      const onStatusChange = vi.fn();
      const ensureSessionForAccount = vi.fn(async () => undefined);
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { result } = renderConnectAccount({
        healthRootPath: ".davora-agent-test",
        unlockRequired: false,
        ports: {
          connectAccount: (request) => registry.connectAccount(request, connectAccountTransport),
          ensureSessionForAccount
        },
        openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
        onStatusChange
      });
      act(() => {
        result.current.setForm({
          ...createEmptyAccountForm("add"),
          baseUrl: "https://cloud.example.com",
          username: "alpha",
          appPassword: requestSentinel
        });
        result.current.setShowDialog(true);
      });

      await runSubmit((event) => result.current.submitAccountForm(event));

      expect(result.current.form.appPassword).toBe("");
      expect(result.current.formError).toBe("The account connected remotely, but could not be saved in this browser.");
      expect(registry.getSnapshot().accounts).toEqual([]);
      expect(stored).toBeNull();
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(ensureSessionForAccount).not.toHaveBeenCalled();
      const view = render(<ConnectAccountDialogStage {...result.current.dialog} />);
      expect(screen.getByLabelText("App password")).toHaveValue("");
      expect(view.container.textContent).not.toMatch(new RegExp(`${requestSentinel}|${responseSentinel}`));
      expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toMatch(new RegExp(`${requestSentinel}|${responseSentinel}`));
      view.unmount();
    }
  );

  it.each(["network", "non-2xx"] as const)("retains credentials after a %s transport failure", async (failureKind) => {
    const requestSentinel = `${failureKind}-request-password-sentinel`;
    const responseSentinel = `${failureKind}-response-secret-sentinel`;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failureKind === "network") throw new Error(responseSentinel);
      return new Response(JSON.stringify({ data: { message: responseSentinel } }), { status: 503 });
    }));
    const registry = createAccountRegistryService({
      readItem: () => ({ ok: true, value: null }),
      writeItem: vi.fn(() => ({ ok: true, value: undefined })),
      deleteItem: vi.fn(() => ({ ok: true, value: undefined }))
    });
    const onStatusChange = vi.fn();
    const ensureSessionForAccount = vi.fn(async () => undefined);
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: { connectAccount: (request) => registry.connectAccount(request, connectAccountTransport), ensureSessionForAccount },
      openerPorts: { pushAccountSurface: vi.fn(), closeSettings: vi.fn() },
      onStatusChange
    });
    act(() => {
      result.current.setForm({
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alpha",
        appPassword: requestSentinel
      });
    });

    await runSubmit((event) => result.current.submitAccountForm(event));

    expect(result.current.form.appPassword).toBe(requestSentinel);
    expect(result.current.formError).toBe("Unable to connect account.");
    expect(registry.getSnapshot().accounts).toEqual([]);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(ensureSessionForAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem("davora-account-state") ?? "").not.toMatch(new RegExp(`${requestSentinel}|${responseSentinel}`));
  });

  it("closes settings before opening reconnect from settings", async () => {
    const closeSettings = vi.fn();
    const pushAccountSurface = vi.fn();
    const activeRecord = {
      account: buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" })
    };
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      activeRecord,
      ports: createPorts(),
      openerPorts: {
        pushAccountSurface,
        closeSettings
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.openReconnectFromSettings();
    });

    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(pushAccountSurface).toHaveBeenCalledTimes(1);
    expect(result.current.form.mode).toBe("reconnect");
    expect(result.current.showDialog).toBe(true);
  });

  it("closes settings before opening a replacement add-account surface", () => {
    const closeSettings = vi.fn();
    const pushAccountSurface = vi.fn();
    const { result } = renderConnectAccount({
      healthRootPath: ".davora-agent-test",
      unlockRequired: false,
      ports: createPorts(),
      openerPorts: { pushAccountSurface, closeSettings },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.openAddAccountFromSettings();
    });

    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(pushAccountSurface).toHaveBeenCalledTimes(1);
    expect(result.current.form.mode).toBe("add");
    expect(result.current.showDialog).toBe(true);
  });
});
