import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyAccountForm } from "./model";

import { ConnectAccountStage } from "./ConnectAccountStage";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildProps(overrides: Partial<ComponentProps<typeof ConnectAccountStage>> = {}) {
  return {
    variant: "zero" as const,
    form: createEmptyAccountForm("add"),
    busy: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    ...overrides
  };
}

describe("ConnectAccountStage", () => {
  afterEach(cleanup);

  it("shows zero-state copy and CTA before the form is revealed", () => {
    render(<ConnectAccountStage {...buildProps({ showForm: false, onRevealForm: vi.fn() })} />);

    expect(screen.getByText(/^Accounts$/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Connect a Nextcloud account inside Davora to start browsing files/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect account$/i })).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(document.querySelector(".zero-state-panel")).toBeInTheDocument();
  });

  it("reveals the zero-state form and emits reveal without session side effects", () => {
    const onRevealForm = vi.fn();

    const { rerender } = render(
      <ConnectAccountStage {...buildProps({ showForm: false, onRevealForm })} />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Connect account$/i }));
    expect(onRevealForm).toHaveBeenCalledTimes(1);

    rerender(<ConnectAccountStage {...buildProps({ showForm: true, onRevealForm })} />);

    expect(screen.getByRole("heading", { name: /Connect Nextcloud account/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Enter your Nextcloud base URL, username, app password, and the root folder to browse/i)
    ).toBeInTheDocument();
    expect(document.querySelector(".account-form")).toBeInTheDocument();
  });

  it("projects connect copy in the bootstrap panel", () => {
    render(<ConnectAccountStage {...buildProps({ variant: "connect" })} />);

    expect(document.querySelector(".bootstrap-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Connect account$/i })).toBeInTheDocument();
    expect(screen.getByText(/Connect a Nextcloud account to continue/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect account$/i })).toBeInTheDocument();
  });

  it("projects reconnect copy with the account name", () => {
    render(
      <ConnectAccountStage
        {...buildProps({
          variant: "reconnect",
          accountName: "Alpha workspace",
          form: createEmptyAccountForm("reconnect")
        })}
      />
    );

    expect(screen.getByRole("heading", { name: /Reconnect Alpha workspace/i })).toBeInTheDocument();
    expect(
      screen.getByText(/The Worker no longer has this account ready\. Re-enter the app password to reconnect/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reconnect account/i })).toBeInTheDocument();
  });

  it("emits form changes and submit without asserting secret values", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn(preventDefaultSubmit);

    render(
      <ConnectAccountStage
        {...buildProps({
          variant: "connect",
          onChange,
          onSubmit
        })}
      />
    );

    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "https://cloud.example.com" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe("object");

    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables submit while busy and surfaces form errors", () => {
    const { rerender } = render(
      <ConnectAccountStage
        {...buildProps({
          variant: "connect",
          busy: true
        })}
      />
    );

    expect(screen.getByRole("button", { name: /^Connect account$/i })).toBeDisabled();

    rerender(
      <ConnectAccountStage
        {...buildProps({
          variant: "connect",
          error: "Base URL, username, and app password are required."
        })}
      />
    );

    expect(screen.getByText("Base URL, username, and app password are required.")).toHaveClass("banner-state", "error");
  });
});
