import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportBugStage, type ReportBugStageProps } from "./ReportBugStage";
import type { ReportSessionPickerEntry } from "./reportModel";

afterEach(cleanup);

const sessionEntry = (overrides: Partial<ReportSessionPickerEntry> = {}): ReportSessionPickerEntry => ({
  id: "s-1",
  label: "Current session (2026-01-02 10:00:00)",
  detail: "5 events, in progress",
  selected: true,
  isCurrent: true,
  ...overrides
});

const buildProps = (overrides: Partial<ReportBugStageProps> = {}): ReportBugStageProps => ({
  open: true,
  sessions: [sessionEntry()],
  preview: {
    sessionCount: 1,
    eventCount: 5,
    estimatedBytes: 2048,
    categories: ["Errors and performance", "Network operations"]
  },
  canShare: true,
  exporting: false,
  canUpload: true,
  uploadReceipt: undefined,
  fileSizeDisplayMode: "human",
  onClose: vi.fn(),
  onToggleSession: vi.fn(),
  onExport: vi.fn(),
  onUpload: vi.fn(),
  ...overrides
});

describe("ReportBugStage", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<ReportBugStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows form fields, the session picker, and the contents preview", () => {
    render(<ReportBugStage {...buildProps()} />);

    expect(screen.getByRole("dialog", { name: /Report a bug/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Bug summary")).toBeInTheDocument();
    expect(screen.getByLabelText("What happened")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected behavior")).toBeInTheDocument();
    expect(screen.getByLabelText("Reproduction steps")).toBeInTheDocument();
    expect(screen.getByLabelText(/Include Current session/)).toBeChecked();

    const preview = screen.getByTestId("report-bug-preview");
    expect(preview).toHaveTextContent("Sessions");
    expect(preview).toHaveTextContent("5");
    expect(preview).toHaveTextContent("Errors and performance, Network operations");
    expect(preview).toHaveTextContent("Nothing is uploaded automatically");
  });

  it("shows the text-only notice when no logs exist", () => {
    render(<ReportBugStage {...buildProps({ sessions: [], preview: undefined })} />);
    expect(screen.getByText(/No diagnostic logs are available/)).toBeInTheDocument();
  });

  it("hides the share button when sharing is unsupported", () => {
    render(<ReportBugStage {...buildProps({ canShare: false })} />);
    expect(screen.queryByRole("button", { name: /Share report/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download report/i })).toBeInTheDocument();
  });

  it("passes the entered form to the export handler", () => {
    const onExport = vi.fn();
    render(<ReportBugStage {...buildProps({ onExport })} />);

    fireEvent.change(screen.getByLabelText("Bug summary"), { target: { value: "Upload stuck" } });
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Spinner never ends" } });
    fireEvent.click(screen.getByRole("button", { name: /Download report/i }));

    expect(onExport).toHaveBeenCalledWith(
      { summary: "Upload stuck", whatHappened: "Spinner never ends", expected: "", reproductionSteps: "" },
      "download"
    );
  });

  it("emits share mode when supported", () => {
    const onExport = vi.fn();
    render(<ReportBugStage {...buildProps({ onExport })} />);
    fireEvent.click(screen.getByRole("button", { name: /Share report/i }));
    expect(onExport).toHaveBeenCalledWith(expect.anything(), "share");
  });

  it("uploads only after the user presses the explicit send action and explains retention", () => {
    const onUpload = vi.fn();
    render(<ReportBugStage {...buildProps({ onUpload })} />);

    expect(screen.getByText(/secure diagnostic inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/30 days/i)).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Bug summary"), { target: { value: "Folder missing" } });
    fireEvent.click(screen.getByRole("button", { name: /Send report/i }));
    expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ summary: "Folder missing" }));
  });

  it("keeps the dialog open and shows the receipt after upload", () => {
    render(<ReportBugStage {...buildProps({
      uploadReceipt: {
        reportId: "123e4567-e89b-42d3-a456-426614174000",
        acceptedAt: "2026-09-24T09:27:58.000Z",
        expiresAfterDays: 30,
        duplicate: false
      }
    })} />);
    expect(screen.getByRole("status")).toHaveTextContent("123e4567-e89b-42d3-a456-426614174000");
  });

  it("disables sending without an eligible authenticated online session and caps form fields", () => {
    render(<ReportBugStage {...buildProps({ canUpload: false })} />);
    expect(screen.getByRole("button", { name: /Send report/i })).toBeDisabled();
    expect(screen.getByLabelText("Bug summary")).toHaveAttribute("maxLength", "160");
    expect(screen.getByLabelText("What happened")).toHaveAttribute("maxLength", "4000");
  });

  it("toggles session selection", () => {
    const onToggleSession = vi.fn();
    render(<ReportBugStage {...buildProps({ onToggleSession })} />);
    fireEvent.click(screen.getByLabelText(/Include Current session/));
    expect(onToggleSession).toHaveBeenCalledWith("s-1");
  });

  it("shows an export failure without hiding the logs", () => {
    render(<ReportBugStage {...buildProps({ exportError: "QuotaExceededError" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("QuotaExceededError");
    expect(screen.getByLabelText(/Include Current session/)).toBeInTheDocument();
  });

  it("disables export buttons while exporting", () => {
    render(<ReportBugStage {...buildProps({ exporting: true })} />);
    expect(screen.getAllByRole("button", { name: /Preparing/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Preparing/ }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
