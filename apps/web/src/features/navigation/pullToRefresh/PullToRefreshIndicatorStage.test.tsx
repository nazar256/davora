import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PullToRefreshIndicatorStage } from "./PullToRefreshIndicatorStage";

describe("PullToRefreshIndicatorStage", () => {
  it("preserves indicator visibility, geometry, ARIA, and copy precedence", () => {
    const { rerender } = render(<PullToRefreshIndicatorStage visible progress={0.5} refreshing={false} />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveAttribute("aria-live", "polite");
    expect(indicator).toHaveStyle({ opacity: "0.5", transform: "translateY(20px)" });
    expect(indicator).toHaveTextContent("Pull to refresh");

    rerender(<PullToRefreshIndicatorStage visible progress={1} refreshing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Release to refresh");
    rerender(<PullToRefreshIndicatorStage visible progress={1} refreshing />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing...");
    rerender(<PullToRefreshIndicatorStage visible={false} progress={0} refreshing={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
