import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionDialogStage } from "./ActionDialogStage";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildProps(overrides: Partial<ComponentProps<typeof ActionDialogStage>> = {}) {
  return {
    open: true,
    title: "Create folder",
    description: "Create a folder in this location.",
    submitLabel: "Create folder",
    busy: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    ...overrides
  };
}

describe("ActionDialogStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<ActionDialogStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders create-folder title, labels, supporting location, and autofocused input", () => {
    render(
      <ActionDialogStage
        {...buildProps({
          label: "Folder name",
          supportingText: "Location: Projects",
          value: "New folder",
          onChange: vi.fn()
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Create folder/i });
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByText("Create a folder in this location.")).toBeInTheDocument();
    expect(within(dialog).getByText("Location: Projects")).toBeInTheDocument();
    const input = within(dialog).getByLabelText("Folder name");
    expect(input).toHaveValue("New folder");
    expect(input).toHaveFocus();
  });

  it("emits value changes and submit/cancel events for create-folder", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onSubmit = vi.fn(preventDefaultSubmit);

    render(
      <ActionDialogStage
        {...buildProps({
          label: "Folder name",
          value: "Draft",
          onChange,
          onClose,
          onSubmit
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Create folder/i });
    fireEvent.change(within(dialog).getByLabelText("Folder name"), { target: { value: "Renamed" } });
    expect(onChange).toHaveBeenCalledWith("Renamed");

    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.submit(dialog.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables create-folder input and submit while busy", () => {
    render(
      <ActionDialogStage
        {...buildProps({
          busy: true,
          label: "Folder name",
          value: "New folder",
          onChange: vi.fn()
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Create folder/i });
    expect(within(dialog).getByLabelText("Folder name")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Create folder/i })).toBeDisabled();
  });

  it("renders delete confirmation with danger submit and no name field", () => {
    render(
      <ActionDialogStage
        {...buildProps({
          title: "Delete item",
          description: "This permanently deletes the selected item from the server.",
          submitLabel: "Delete",
          danger: true,
          targetText: "Projects/report.txt"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Delete item/i });
    expect(within(dialog).getByText("This permanently deletes the selected item from the server.")).toBeInTheDocument();
    expect(within(dialog).getByText("Projects/report.txt")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Delete$/i })).toHaveClass("button-danger");
  });

  it("renders batch delete title, description, and target list", () => {
    render(
      <ActionDialogStage
        {...buildProps({
          title: "Delete 2 items",
          description: "This permanently deletes the selected items from the server.",
          submitLabel: "Delete",
          danger: true,
          targetText: "Projects/a.txt\nProjects/b.txt"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Delete 2 items/i });
    expect(within(dialog).getByText("This permanently deletes the selected items from the server.")).toBeInTheDocument();
    expect(within(dialog).getByText((_, element) => element?.classList.contains("dialog-target") ?? false)).toHaveTextContent("Projects/a.txt");
    expect(within(dialog).getByText((_, element) => element?.classList.contains("dialog-target") ?? false)).toHaveTextContent("Projects/b.txt");
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an error banner when provided", () => {
    render(<ActionDialogStage {...buildProps({ error: "Folder already exists." })} />);
    expect(screen.getByText("Folder already exists.")).toHaveClass("banner-state", "error");
  });

  it("dismisses on scrim click", () => {
    const onClose = vi.fn();
    const { container } = render(<ActionDialogStage {...buildProps({ onClose })} />);
    fireEvent.click(container.querySelector(".modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss when clicking inside the dialog card", () => {
    const onClose = vi.fn();
    render(<ActionDialogStage {...buildProps({ onClose })} />);
    fireEvent.click(screen.getByRole("dialog", { name: /Create folder/i }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
