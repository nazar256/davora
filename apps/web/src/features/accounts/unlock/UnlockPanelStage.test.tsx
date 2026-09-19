import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnlockPanelStage } from "./UnlockPanelStage";

function buildProps(overrides: Partial<ComponentProps<typeof UnlockPanelStage>> = {}) {
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

describe("UnlockPanelStage", () => {
  afterEach(cleanup);

  it("projects account identity copy in the panel header and body", () => {
    render(
      <UnlockPanelStage
        {...buildProps({
          accountName: "Beta workspace",
          accountHost: "nextcloud.example.org"
        })}
      />
    );

    expect(screen.getByRole("heading", { name: /Unlock required/i })).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText(/Connected account:/i)).toBeInTheDocument();
    expect(screen.getByText("Beta workspace")).toBeInTheDocument();
    expect(screen.getByText(/\(nextcloud\.example\.org\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Unlock code")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Unlock and connect/i })).toBeInTheDocument();
  });

  it("emits unlock-code changes and submit without session side effects", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    render(<UnlockPanelStage {...buildProps({ onChange, onSubmit })} />);

    const unlockInput = screen.getByLabelText("Unlock code");
    expect(unlockInput).toHaveAttribute("type", "password");

    fireEvent.change(unlockInput, { target: { value: "x".repeat(12) } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe("string");
    expect(String(onChange.mock.calls[0]?.[0]).length).toBe(12);

    fireEvent.submit(screen.getByRole("button", { name: /Unlock and connect/i }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables input and submit while busy and shows connecting projection", () => {
    render(<UnlockPanelStage {...buildProps({ busy: true })} />);

    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText("Submitting unlock code…")).toHaveClass("banner-state", "loading");
    expect(screen.getByLabelText("Unlock code")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Unlock and connect/i })).toBeDisabled();
  });

  it("shows an error banner when provided and idle", () => {
    render(
      <UnlockPanelStage
        {...buildProps({
          error: "Enter the deployment unlock code to create a session."
        })}
      />
    );

    expect(screen.getByText("Enter the deployment unlock code to create a session.")).toHaveClass("banner-state", "error");
  });
});
