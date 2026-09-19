import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyAccountForm } from "../connect";
import type { ConnectAccountStageProps } from "../connect";
import type { RestoreSessionStageProps } from "../restore";
import type { UnlockPanelStageProps } from "../unlock";

import { AccountBootstrapShell } from "./AccountBootstrapShell";
import type { AccountBootstrapGate } from "./model";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildSlots(overrides: Partial<{ reloadPrompt: ReactNode; appBar: ReactNode; navDrawer: ReactNode }> = {}) {
  return {
    reloadPrompt: <div data-testid="reload-prompt">reload</div>,
    appBar: <header data-testid="app-bar">app bar</header>,
    navDrawer: <nav data-testid="nav-drawer">nav</nav>,
    ...overrides
  };
}

function buildConnectStageProps(overrides: Partial<ConnectAccountStageProps> = {}): ConnectAccountStageProps {
  return {
    variant: "zero",
    form: createEmptyAccountForm("add"),
    busy: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    showForm: false,
    onRevealForm: vi.fn(),
    ...overrides
  };
}

function buildUnlockStageProps(overrides: Partial<UnlockPanelStageProps> = {}): UnlockPanelStageProps {
  return {
    accountName: "Alpha workspace",
    accountHost: "cloud.example.com",
    unlockCode: "",
    busy: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides
  };
}

function buildRestoreStageProps(overrides: Partial<RestoreSessionStageProps> = {}): RestoreSessionStageProps {
  return {
    accountName: "Alpha workspace",
    busy: false,
    canRetryRestore: true,
    onRetryRestore: vi.fn(),
    ...overrides
  };
}

function renderShell(
  gate: AccountBootstrapGate,
  overrides: Partial<ComponentProps<typeof AccountBootstrapShell>> = {}
) {
  return render(
    <AccountBootstrapShell
      gate={gate}
      {...buildSlots()}
      connectStage={buildConnectStageProps()}
      unlockStage={buildUnlockStageProps()}
      restoreStage={buildRestoreStageProps()}
      {...overrides}
    />
  );
}

describe("AccountBootstrapShell", () => {
  afterEach(cleanup);

  it("always mounts ReloadPrompt and AppBar for bootstrap gates", () => {
    renderShell({ kind: "healthChecking" });

    expect(screen.getByTestId("reload-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("app-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-drawer")).not.toBeInTheDocument();
  });

  it("projects healthChecking with a loading banner only", () => {
    renderShell({ kind: "healthChecking" });

    expect(screen.getByText("Checking session requirements…")).toHaveClass("banner-state", "loading");
    expect(screen.queryByRole("heading", { name: /No connected accounts yet/i })).not.toBeInTheDocument();
  });

  it("projects unavailable storage without mounting credential entry", () => {
    renderShell({ kind: "unavailable" }, { bootstrapError: "raw storage error sentinel" });

    expect(screen.getByText("Saved account data is unavailable. Restore browser storage access, then reload Davora.")).toHaveClass("banner-state", "error");
    expect(screen.queryByLabelText(/Base URL|Username|App password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect account/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/raw storage error sentinel/i)).not.toBeInTheDocument();
  });

  it("projects noAccounts with optional bootstrap error and connect stage", () => {
    renderShell({ kind: "noAccounts" }, { bootstrapError: "Worker configuration is incomplete." });

    expect(screen.getByText("Worker configuration is incomplete.")).toHaveClass("banner-state", "error");
    expect(screen.getByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.queryByTestId("nav-drawer")).not.toBeInTheDocument();
  });

  it("projects connect and reconnect with NavDrawer and connect stage", () => {
    const { rerender } = renderShell(
      { kind: "connect" },
      {
        connectStage: buildConnectStageProps({ variant: "connect" })
      }
    );

    expect(screen.getByTestId("nav-drawer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Connect account$/i })).toBeInTheDocument();

    rerender(
      <AccountBootstrapShell
        gate={{ kind: "reconnect" }}
        {...buildSlots()}
        connectStage={buildConnectStageProps({
          variant: "reconnect",
          accountName: "Alpha workspace"
        })}
        restoreStage={buildRestoreStageProps()}
        unlockStage={buildUnlockStageProps()}
      />
    );

    expect(screen.getByRole("heading", { name: /Reconnect Alpha workspace/i })).toBeInTheDocument();
  });

  it("projects unlock with NavDrawer and unlock stage events", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    renderShell(
      { kind: "unlock" },
      {
        unlockStage: buildUnlockStageProps({ onChange, onSubmit })
      }
    );

    expect(screen.getByTestId("nav-drawer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Unlock required/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Unlock code"), { target: { value: "x".repeat(8) } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe("string");

    fireEvent.submit(screen.getByRole("button", { name: /Unlock and connect/i }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("projects restore with NavDrawer and retry events", () => {
    const onRetryRestore = vi.fn();

    renderShell(
      { kind: "restore" },
      {
        restoreStage: buildRestoreStageProps({ onRetryRestore })
      }
    );

    expect(screen.getByTestId("nav-drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry restore/i }));
    expect(onRetryRestore).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for continue so the caller can mount the main shell", () => {
    const { container } = renderShell({ kind: "continue" });

    expect(container).toBeEmptyDOMElement();
  });
});
