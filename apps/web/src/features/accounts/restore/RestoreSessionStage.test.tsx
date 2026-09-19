import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RestoreSessionStage } from "./RestoreSessionStage";

function buildProps(overrides: Partial<ComponentProps<typeof RestoreSessionStage>> = {}) {
  return {
    accountName: "Alpha workspace",
    busy: false,
    canRetryRestore: true,
    onRetryRestore: vi.fn(),
    ...overrides
  };
}

describe("RestoreSessionStage", () => {
  afterEach(cleanup);

  it("shows a loading banner with account copy and hides retry while busy", () => {
    render(<RestoreSessionStage {...buildProps({ busy: true })} />);

    expect(screen.getByText("Restoring workspace access for Alpha workspace…")).toHaveClass("banner-state", "loading");
    expect(screen.queryByRole("button", { name: /Retry restore/i })).not.toBeInTheDocument();
  });

  it("shows an error banner and retry when idle with an error", () => {
    const onRetryRestore = vi.fn();

    render(
      <RestoreSessionStage
        {...buildProps({
          error: "Session expired",
          onRetryRestore
        })}
      />
    );

    expect(screen.getByText("Session expired")).toHaveClass("banner-state", "error");
    expect(screen.getByRole("button", { name: /Retry restore/i })).toBeInTheDocument();
  });

  it("renders idle without banner markup when neither busy nor error", () => {
    render(<RestoreSessionStage {...buildProps()} />);

    expect(screen.queryByText(/Restoring workspace access/i)).not.toBeInTheDocument();
    expect(document.querySelector(".banner-state")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry restore/i })).toBeInTheDocument();
  });

  it("hides retry when restore is not available", () => {
    render(<RestoreSessionStage {...buildProps({ canRetryRestore: false, error: "Session expired" })} />);

    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry restore/i })).not.toBeInTheDocument();
  });

  it("emits retry-restore without session side effects", () => {
    const onRetryRestore = vi.fn();

    render(<RestoreSessionStage {...buildProps({ onRetryRestore })} />);

    fireEvent.click(screen.getByRole("button", { name: /Retry restore/i }));

    expect(onRetryRestore).toHaveBeenCalledTimes(1);
  });
});
