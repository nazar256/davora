import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountFormStage } from "./AccountFormStage";
import { buildReconnectForm, createEmptyAccountForm } from "./model";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildProps(overrides: Partial<ComponentProps<typeof AccountFormStage>> = {}) {
  return {
    form: createEmptyAccountForm("add"),
    busy: false,
    title: "Connect Nextcloud account",
    description: "Enter your server address and Nextcloud app password.",
    submitLabel: "Connect account",
    onChange: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    ...overrides
  };
}

describe("AccountFormStage", () => {
  afterEach(cleanup);

  it("renders add-account title, fields, and submit label", () => {
    render(
      <AccountFormStage
        {...buildProps({
          title: "Add Nextcloud account",
          description: "Add another Nextcloud account.",
          submitLabel: "Add account"
        })}
      />
    );

    expect(screen.getByRole("heading", { name: /Add Nextcloud account/i })).toBeInTheDocument();
    expect(screen.getByText("Add another Nextcloud account.")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("");
    expect(screen.getByLabelText("App password")).toHaveValue("");
    expect(screen.getByLabelText("Root folder")).toHaveValue("");
    expect(screen.getByLabelText("Label")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Add account$/i })).toBeInTheDocument();
  });

  it("renders reconnect projection with prefilled non-secret fields", () => {
    const form = buildReconnectForm({
      account: {
        id: "acct-alpha",
        cacheNamespace: "ns-alpha",
        baseUrl: "https://cloud.example.com",
        username: "alpha-user",
        rootPath: "/Projects",
        label: "Alpha workspace"
      },
      pendingReconnect: {
        baseUrl: "https://cloud.example.com",
        username: "alpha-user",
        label: "Alpha workspace"
      }
    });

    render(
      <AccountFormStage
        {...buildProps({
          form,
          title: "Reconnect Alpha workspace",
          description: "Enter a fresh Nextcloud app password to reconnect.",
          submitLabel: "Reconnect account"
        })}
      />
    );

    expect(screen.getByRole("heading", { name: /Reconnect Alpha workspace/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://cloud.example.com");
    expect(screen.getByLabelText("Username")).toHaveValue("alpha-user");
    expect(screen.getByLabelText("App password")).toHaveValue("");
    expect(screen.getByLabelText("Root folder")).toHaveValue("/Projects");
    expect(screen.getByLabelText("Label")).toHaveValue("Alpha workspace");
    expect(screen.getByRole("button", { name: /^Reconnect account$/i })).toBeInTheDocument();
  });

  it("emits field changes and submit without connect side effects", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn(preventDefaultSubmit);

    render(<AccountFormStage {...buildProps({ onChange, onSubmit })} />);

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://cloud.example.com" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://cloud.example.com" }));

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alpha-user" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ username: "alpha-user" }));

    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders cancel only when onCancel is provided", () => {
    const { rerender } = render(<AccountFormStage {...buildProps()} />);
    expect(screen.queryByRole("button", { name: /Cancel/i })).not.toBeInTheDocument();

    const onCancel = vi.fn();
    rerender(<AccountFormStage {...buildProps({ onCancel })} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables inputs and submit while busy", () => {
    render(<AccountFormStage {...buildProps({ busy: true })} />);

    expect(screen.getByLabelText("Base URL")).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("App password")).toBeDisabled();
    expect(screen.getByLabelText("Root folder")).toBeDisabled();
    expect(screen.getByLabelText("Label")).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Connect account$/i })).toBeDisabled();
  });

  it("shows an error banner when provided", () => {
    render(<AccountFormStage {...buildProps({ error: "Base URL, username, and app password are required." })} />);
    expect(screen.getByText("Base URL, username, and app password are required.")).toHaveClass("banner-state", "error");
  });
});

describe("accountForm model helpers", () => {
  it("createEmptyAccountForm returns an empty add form by default", () => {
    expect(createEmptyAccountForm()).toEqual({
      mode: "add",
      baseUrl: "",
      username: "",
      appPassword: "",
      rootPath: "",
      label: ""
    });
  });

  it("buildReconnectForm prefers pending reconnect values and clears app password", () => {
    expect(
      buildReconnectForm({
        account: {
          id: "acct-beta",
          cacheNamespace: "ns-beta",
          baseUrl: "https://stored.example.com",
          username: "stored-user",
          rootPath: "/",
          label: "Stored label"
        },
        pendingReconnect: {
          baseUrl: "https://pending.example.com",
          username: "pending-user",
          label: "Pending label"
        }
      })
    ).toEqual({
      mode: "reconnect",
      accountId: "acct-beta",
      cacheNamespace: "ns-beta",
      baseUrl: "https://pending.example.com",
      username: "pending-user",
      appPassword: "",
      rootPath: "/",
      label: "Pending label"
    });
  });
});
