import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectAccountDialogStage } from "./ConnectAccountDialogStage";
import { createEmptyAccountForm } from "./model";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildProps(overrides: Partial<ComponentProps<typeof ConnectAccountDialogStage>> = {}) {
  return {
    open: true,
    variant: "add" as const,
    form: createEmptyAccountForm("add"),
    busy: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    onCancel: vi.fn(),
    ...overrides
  };
}

describe("ConnectAccountDialogStage", () => {
  afterEach(cleanup);

  it("does not render when closed", () => {
    render(<ConnectAccountDialogStage {...buildProps({ open: false })} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["add", "Add account", "Add Nextcloud account", "Connect another Nextcloud account without disturbing the current file-manager workspace design."],
    ["reconnect", "Reconnect account", "Reconnect account", "Re-enter the app password so this account can create fresh sessions again."]
  ] as const)("projects %s modal copy and form bindings", (variant, ariaLabel, title, description) => {
    render(
      <ConnectAccountDialogStage
        {...buildProps({
          form: createEmptyAccountForm(variant),
          variant
        })}
      />
    );

    expect(screen.getByRole("dialog", { name: ariaLabel })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: title === "Reconnect account" ? title : "Add account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAttribute("tabindex", "-1");
  });

  it("cancels from the form and only dismisses on an exact scrim click", () => {
    const onCancel = vi.fn();
    render(<ConnectAccountDialogStage {...buildProps({ onCancel })} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    const scrim = document.querySelector(".modal-scrim");
    const dialog = screen.getByRole("dialog");
    if (!scrim) {
      throw new Error("dialog scrim is unavailable");
    }
    fireEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(scrim);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps cancel and submit disabled while busy", () => {
    render(<ConnectAccountDialogStage {...buildProps({ busy: true })} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add account" })).toBeDisabled();
    expect(screen.getByLabelText("App password")).toBeDisabled();
  });

  it("passes field changes and submit through without rendering the password as text", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn(preventDefaultSubmit);
    const password = "sentinel-password-never-rendered";
    render(<ConnectAccountDialogStage {...buildProps({ onChange, onSubmit })} />);

    fireEvent.change(screen.getByLabelText("App password"), { target: { value: password } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ appPassword: password }));
    expect(document.body.textContent).not.toContain(password);

    fireEvent.submit(screen.getByRole("button", { name: "Add account" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
