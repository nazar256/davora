// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickActionsStage, type QuickActionsStageProps } from "./QuickActionsStage";

function buildProps(overrides: Partial<QuickActionsStageProps> = {}): QuickActionsStageProps {
  return {
    open: false,
    canUploadFiles: true,
    canUploadFolders: true,
    canCreateFolder: true,
    mutationBusy: false,
    onToggle: vi.fn(),
    onDismiss: vi.fn(),
    onUploadFiles: vi.fn<(files: FileList | File[] | null) => void>(),
    onUploadFolder: vi.fn<(files: FileList | File[] | null) => void>(),
    onCreateFolder: vi.fn(),
    directoryUploadInputRef: vi.fn(),
    ...overrides
  };
}

describe("QuickActionsStage", () => {
  afterEach(cleanup);

  it("renders a collapsed quick-action button with menu semantics", () => {
    render(<QuickActionsStage {...buildProps()} />);

    const fab = screen.getByRole("button", { name: "Quick actions" });
    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(fab).toHaveAttribute("aria-haspopup", "menu");
    expect(fab).toHaveAttribute("aria-controls", "quick-actions-menu");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss quick actions" })).toBeNull();
  });

  it("expands upward into Upload files, Upload folder, and New folder and focuses the first item", () => {
    render(<QuickActionsStage {...buildProps({ open: true })} />);

    const menu = screen.getByRole("menu", { name: "Quick actions" });
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Upload files", "Upload folder", "New folder"]);
    expect(document.activeElement).toBe(items[0]);
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick actions" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Dismiss quick actions" })).toBeInTheDocument();
  });

  it("invokes toggle on the FAB, dismiss on the scrim, and closes on Escape with focus return", () => {
    const onToggle = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<QuickActionsStage {...buildProps({ onDismiss, onToggle })} />);
    const fab = screen.getByRole("button", { name: "Quick actions" });

    fireEvent.click(fab);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<QuickActionsStage {...buildProps({ onDismiss, onToggle, open: true })} />);
    expect(document.activeElement).toHaveTextContent("Upload files");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss quick actions" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const focusedItem = document.activeElement;
    if (!focusedItem) throw new Error("expected a focused menu item");
    fireEvent.keyDown(focusedItem, { key: "Escape" });
    expect(document.activeElement).toBe(fab);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("dismisses before invoking New folder so the dialog can take focus", () => {
    const events: string[] = [];
    const onDismiss = vi.fn(() => events.push("dismiss"));
    const onCreateFolder = vi.fn(() => events.push("create-folder"));
    render(<QuickActionsStage {...buildProps({ onCreateFolder, onDismiss, open: true })} />);

    fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }));

    expect(events).toEqual(["dismiss", "create-folder"]);
  });

  it("opens the file picker for Upload files and forwards the selection", () => {
    const onDismiss = vi.fn();
    const onUploadFiles = vi.fn<(files: FileList | File[] | null) => void>();
    const { container } = render(<QuickActionsStage {...buildProps({ onDismiss, onUploadFiles, open: true })} />);
    const input = container.querySelector<HTMLInputElement>(".quick-actions-input");
    if (!input) throw new Error("expected file input");
    const click = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("menuitem", { name: "Upload files" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const file = new File(["data"], "report.txt");
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUploadFiles.mock.calls[0]?.[0]?.[0]).toBe(file);
  });

  it("opens the directory picker for Upload folder through the shared ref port", () => {
    const directoryUploadInputRef = vi.fn();
    const onDismiss = vi.fn();
    const onUploadFolder = vi.fn<(files: FileList | File[] | null) => void>();
    const { container } = render(<QuickActionsStage {...buildProps({ directoryUploadInputRef, onDismiss, onUploadFolder, open: true })} />);
    const inputs = container.querySelectorAll<HTMLInputElement>(".quick-actions-input");
    const folderInput = inputs[1];
    if (!folderInput) throw new Error("expected folder input");
    const click = vi.spyOn(folderInput, "click");

    expect(directoryUploadInputRef).toHaveBeenCalledWith(folderInput);

    fireEvent.click(screen.getByRole("menuitem", { name: "Upload folder" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const file = new File(["data"], "nested.txt");
    fireEvent.change(folderInput, { target: { files: [file] } });
    expect(onUploadFolder.mock.calls[0]?.[0]?.[0]).toBe(file);
  });

  it("keeps hidden inputs untabbable with unique labels and resets their value after change", () => {
    const onUploadFiles = vi.fn<(files: FileList | File[] | null) => void>();
    const { container } = render(<QuickActionsStage {...buildProps({ onUploadFiles })} />);
    const inputs = container.querySelectorAll<HTMLInputElement>(".quick-actions-input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute("aria-label", "Upload files from quick actions");
    expect(inputs[1]).toHaveAttribute("aria-label", "Upload folder from quick actions");
    for (const input of inputs) {
      expect(input).toHaveAttribute("tabindex", "-1");
    }

    const fileInput = inputs[0];
    if (!fileInput) throw new Error("expected file input");
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "x.txt")] } });
    expect(fileInput.value).toBe("");
  });

  it("disables unavailable actions independently and while mutations are busy", () => {
    render(<QuickActionsStage {...buildProps({ canCreateFolder: false, canUploadFolders: false, mutationBusy: false, open: true })} />);
    expect(screen.getByRole("menuitem", { name: "Upload files" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Upload folder" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "New folder" })).toBeDisabled();
  });

  it("disables every action while a mutation is busy", () => {
    render(<QuickActionsStage {...buildProps({ mutationBusy: true, open: true })} />);
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toBeDisabled();
    }
  });

  it("roves focus with arrow keys, Home, and End across enabled items", () => {
    render(<QuickActionsStage {...buildProps({ canUploadFolders: false, open: true })} />);
    const items = screen.getAllByRole("menuitem").filter((item) => !item.hasAttribute("disabled"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });
});
