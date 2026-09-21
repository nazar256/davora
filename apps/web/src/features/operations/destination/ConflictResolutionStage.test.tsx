import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFileEntry } from "../../../test/files";
import { ConflictResolutionStage } from "./ConflictResolutionStage";
import type { DestinationConflictReview } from "./model";

function buildReview(overrides: Partial<DestinationConflictReview> = {}): DestinationConflictReview {
  const source = buildFileEntry("Projects/report.txt", { size: 100 });
  const existing = buildFileEntry("Archive/report.txt", { size: 40 });
  return {
    operation: "copy",
    destinationPath: "Archive",
    targets: [{ source, destinationPath: "Archive/report.txt" }],
    items: [{
      source,
      existing,
      destinationPath: "Archive/report.txt",
      isSelfCollision: false,
      allowedDecisions: ["replace", "keepBoth", "skip"]
    }],
    applySizeRule: true,
    ...overrides
  };
}

function buildProps(overrides: Partial<ComponentProps<typeof ConflictResolutionStage>> = {}) {
  return {
    open: true,
    review: buildReview(),
    busy: false,
    onDecisionChange: vi.fn(),
    onApplyToAll: vi.fn(),
    onApplySizeRuleChange: vi.fn(),
    onConfirm: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe("ConflictResolutionStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<ConflictResolutionStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the dialog with source and existing metadata plus paths", () => {
    render(<ConflictResolutionStage {...buildProps()} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "Resolve 1 conflict" })).toBeInTheDocument();
    expect(dialog.textContent).toContain("Copy 1 item to Archive");
    expect(within(dialog).getByText("Incoming")).toBeInTheDocument();
    expect(within(dialog).getByText("Existing")).toBeInTheDocument();
    expect(within(dialog).getByText(/Projects\/report\.txt/)).toBeInTheDocument();
  });

  it("renders only the allowed decisions and marks self-collisions", () => {
    const review = buildReview();
    const selfItem = {
      ...review.items[0],
      isSelfCollision: true,
      allowedDecisions: ["keepBoth", "skip"] as const
    };
    render(<ConflictResolutionStage {...buildProps({ review: { ...review, items: [selfItem] } })} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });
    expect(within(dialog).getByText("Same item at the destination")).toBeInTheDocument();
    const group = within(dialog).getByRole("radiogroup", { name: "Decision for report.txt" });
    expect(within(group).getByRole("radio", { name: "Keep both report.txt" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Skip report.txt" })).toBeInTheDocument();
    expect(within(group).queryByRole("radio", { name: "Replace report.txt" })).not.toBeInTheDocument();
    expect(within(group).queryByRole("radio", { name: "Merge report.txt" })).not.toBeInTheDocument();
  });

  it("emits per-item decisions and bulk actions", () => {
    const props = buildProps();
    render(<ConflictResolutionStage {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });

    fireEvent.click(within(dialog).getByRole("radio", { name: "Keep both report.txt" }));
    expect(props.onDecisionChange).toHaveBeenCalledWith("Projects/report.txt", "keepBoth");

    fireEvent.click(within(dialog).getByRole("button", { name: "Skip all" }));
    expect(props.onApplyToAll).toHaveBeenCalledWith("skip");
    expect(within(dialog).queryByRole("button", { name: "Merge all" })).not.toBeInTheDocument();
  });

  it("toggles the size rule and reflects it in effective decisions", () => {
    const props = buildProps();
    const { rerender } = render(<ConflictResolutionStage {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });

    const ruleToggle = within(dialog).getByRole("checkbox", {
      name: "Replace files when the incoming file is the same size or larger"
    });
    expect(ruleToggle).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Replace report.txt" })).toBeChecked();

    fireEvent.click(ruleToggle);
    expect(props.onApplySizeRuleChange).toHaveBeenCalledWith(false);

    rerender(<ConflictResolutionStage {...props} review={{ ...props.review, applySizeRule: false }} />);
    expect(within(dialog).getByRole("radio", { name: "Skip report.txt" })).toBeChecked();
  });

  it("skips by default when the incoming file is smaller than the existing file", () => {
    const review = buildReview();
    const item = { ...review.items[0], source: { ...review.items[0].source, size: 10 } };
    render(<ConflictResolutionStage {...buildProps({ review: { ...review, items: [item] } })} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });
    expect(within(dialog).getByRole("radio", { name: "Skip report.txt" })).toBeChecked();
    expect(within(dialog).getByText(/the incoming item is not copied/i)).toBeInTheDocument();
  });

  it("emits back, confirm, and close with a decision summary in the confirm label", () => {
    const props = buildProps();
    render(<ConflictResolutionStage {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Back$/i }));
    expect(props.onBack).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: /Copy with these choices \(1 replace\)/i }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close conflict resolution" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables actions while busy", () => {
    render(<ConflictResolutionStage {...buildProps({ busy: true })} />);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });
    expect(within(dialog).getByRole("button", { name: /^Back$/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Copy with these choices/i })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Skip report.txt" })).toBeDisabled();
  });

  it("resolves image previews only when both sides are images", async () => {
    const resolvePreviewUrl = vi.fn().mockResolvedValue("blob:preview");
    const imageReview = buildReview();
    const imageItem = {
      ...imageReview.items[0],
      source: { ...imageReview.items[0].source, mimeType: "image/png" },
      existing: { ...imageReview.items[0].existing, mimeType: "image/jpeg" }
    };
    render(
      <ConflictResolutionStage
        {...buildProps({ resolvePreviewUrl, review: { ...imageReview, items: [imageItem] } })}
      />
    );

    await waitFor(() => expect(resolvePreviewUrl).toHaveBeenCalledTimes(2));
    expect(resolvePreviewUrl).toHaveBeenCalledWith(imageItem.source);
    expect(resolvePreviewUrl).toHaveBeenCalledWith(imageItem.existing);
    const dialog = screen.getByRole("dialog", { name: "Resolve destination conflicts" });
    await waitFor(() => expect(dialog.querySelectorAll("img")).toHaveLength(2));
  });

  it("renders icons instead of resolving previews for non-image conflicts", async () => {
    const resolvePreviewUrl = vi.fn().mockResolvedValue("blob:preview");
    render(<ConflictResolutionStage {...buildProps({ resolvePreviewUrl })} />);
    await waitFor(() => expect(
      screen.getByRole("dialog", { name: "Resolve destination conflicts" })
    ).toBeInTheDocument());
    expect(resolvePreviewUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
