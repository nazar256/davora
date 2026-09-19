import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceStatusStage } from "./WorkspaceStatusStage";

describe("WorkspaceStatusStage", () => {
  it("keeps the status slot for an idle banner without rendering banner content", () => {
    const { container } = render(
      <WorkspaceStatusStage banner={{ kind: "idle", message: "Ready" }} />
    );

    expect(container.querySelector(".state-banner-slot")).toBeInTheDocument();
    expect(container.querySelector(".banner-state")).toBeNull();
  });

  it.each([
    ["loading", "Loading files"],
    ["offline", "Connection unavailable"]
  ] as const)("forwards the %s banner binding unchanged", (kind, message) => {
    const { container } = render(<WorkspaceStatusStage banner={{ kind, message }} />);

    expect(container.querySelector(`.banner-state.${kind}`)).toHaveTextContent(message);
  });

  it("omits an absent offline toggle", () => {
    const { container } = render(
      <WorkspaceStatusStage banner={{ kind: "idle", message: "Ready" }} />
    );

    expect(container.querySelector(".offline-mode-toggle")).toBeNull();
  });

  it("preserves the offline toggle button contract and callback", () => {
    const onToggle = vi.fn();
    render(
      <WorkspaceStatusStage
        banner={{ kind: "idle", message: "Ready" }}
        offlineToggle={{ label: "Go offline", onToggle }}
      />
    );

    const button = screen.getByRole("button", { name: "Go offline" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("quiet-button", "offline-mode-toggle");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reconciles banner and toggle transitions without stale or duplicate nodes", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <WorkspaceStatusStage banner={{ kind: "idle", message: "Ready" }} />
    );

    rerender(
      <WorkspaceStatusStage
        banner={{ kind: "error", message: "Failed to load" }}
        offlineToggle={{ label: "Go offline", onToggle }}
      />
    );
    expect(container.querySelectorAll(".state-banner-slot")).toHaveLength(1);
    expect(container.querySelectorAll(".banner-state")).toHaveLength(1);
    expect(container.querySelectorAll(".offline-mode-toggle")).toHaveLength(1);

    rerender(<WorkspaceStatusStage banner={{ kind: "idle", message: "Ready" }} />);
    expect(container.querySelectorAll(".state-banner-slot")).toHaveLength(1);
    expect(container.querySelector(".banner-state")).toBeNull();
    expect(container.querySelector(".offline-mode-toggle")).toBeNull();
  });
});
