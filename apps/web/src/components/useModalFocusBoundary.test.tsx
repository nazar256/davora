import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

import { useModalFocusBoundary } from "./useModalFocusBoundary";

function Boundary({ open = true, children, onDismiss }: { readonly open?: boolean; readonly children?: ReactNode; readonly onDismiss?: () => void }) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(open, onDismiss);
  if (!open) return null;
  return <section aria-label="Test modal" aria-modal="true" ref={dialogRef} role="dialog" tabIndex={-1}>{children}</section>;
}

async function flushFocusRestore(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useModalFocusBoundary", () => {
  afterEach(async () => {
    cleanup();
    await flushFocusRestore();
  });

  it("wraps forward and reverse Tab navigation over the live tabbable set", () => {
    const { rerender } = render(
      <Boundary>
        <button data-testid="first" type="button">First</button>
        <button disabled type="button">Disabled</button>
        <button hidden type="button">Hidden</button>
      </Boundary>
    );

    const dialog = document.querySelector('[role="dialog"]');
    const first = document.querySelector<HTMLButtonElement>('[data-testid="first"]');
    if (!dialog || !first) throw new Error("Test modal controls are unavailable.");
    expect(first).toHaveFocus();

    rerender(
      <Boundary>
        <button data-testid="first" type="button">First</button>
        <button disabled type="button">Disabled</button>
        <button hidden type="button">Hidden</button>
        <button data-testid="dynamic" type="button">Dynamic</button>
      </Boundary>
    );
    const dynamic = document.querySelector<HTMLButtonElement>('[data-testid="dynamic"]');
    if (!dynamic) throw new Error("Dynamic test control is unavailable.");

    fireEvent.keyDown(first, { key: "Tab" });
    expect(dynamic).toHaveFocus();
    fireEvent.keyDown(dynamic, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(dynamic).toHaveFocus();
  });

  it("focuses the first control, preserves autoFocus, and falls back to the dialog root", async () => {
    const { unmount } = render(
      <Boundary>
        <input autoFocus aria-label="Auto focused" />
        <button type="button">Other</button>
      </Boundary>
    );
    const autoFocused = document.querySelector<HTMLInputElement>('[aria-label="Auto focused"]');
    if (!autoFocused) throw new Error("Auto-focus control is unavailable.");
    expect(autoFocused).toHaveFocus();

    unmount();
    await flushFocusRestore();
    render(<Boundary />);
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("Test modal is unavailable.");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
  });

  it("returns focus to a connected opener after the complete session closes", async () => {
    const { rerender } = render(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary open={false}><button type="button">Modal control</button></Boundary>
      </div>
    );
    const opener = document.querySelector<HTMLButtonElement>('[data-testid="opener"]');
    if (!opener) throw new Error("Modal opener is unavailable.");
    opener.focus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary><button type="button">Modal control</button></Boundary>
      </div>
    );
    expect(document.querySelector('[role="dialog"] button')).toHaveFocus();

    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary open={false}><button type="button">Modal control</button></Boundary>
      </div>
    );
    await flushFocusRestore();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="opener"]')).toHaveFocus();
  });

  it("dismisses the active boundary on Escape and consumes the key", () => {
    const onDismiss = vi.fn();
    render(
      <Boundary onDismiss={onDismiss}>
        <button type="button">Modal control</button>
      </Boundary>
    );
    const control = document.querySelector<HTMLButtonElement>('[role="dialog"] button');
    if (!control) throw new Error("Modal control is unavailable.");

    const escape = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    control.dispatchEvent(escape);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
  });

  it("does not steal focus selected by a close handler or restore a disconnected opener", async () => {
    const { rerender } = render(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <button data-testid="destination" type="button">Destination</button>
        <Boundary><button type="button">Modal control</button></Boundary>
      </div>
    );
    const opener = document.querySelector<HTMLButtonElement>('[data-testid="opener"]');
    const destination = document.querySelector<HTMLButtonElement>('[data-testid="destination"]');
    if (!opener || !destination) throw new Error("Focus return controls are unavailable.");
    opener.focus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <button data-testid="destination" type="button">Destination</button>
        <Boundary><button type="button">Modal control</button></Boundary>
      </div>
    );
    destination.focus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <button data-testid="destination" type="button">Destination</button>
        <Boundary open={false}><button type="button">Modal control</button></Boundary>
      </div>
    );
    await flushFocusRestore();
    expect(destination).toHaveFocus();

    opener.focus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary><button type="button">Modal control</button></Boundary>
      </div>
    );
    rerender(
      <div>
        <Boundary><button type="button">Modal control</button></Boundary>
      </div>
    );
    const detachedDialog = document.querySelector('[role="dialog"]');
    if (!detachedDialog) throw new Error("Detached-dialog test modal is unavailable.");
    rerender(
      <div>
        <Boundary open={false}><button type="button">Modal control</button></Boundary>
      </div>
    );
    await flushFocusRestore();
    expect(detachedDialog.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(detachedDialog);
  });

  it("hands off a replacement modal without an intermediate opener restore", async () => {
    const { rerender } = render(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary open={false}><button type="button">First</button></Boundary>
      </div>
    );
    const opener = document.querySelector<HTMLButtonElement>('[data-testid="opener"]');
    if (!opener) throw new Error("Modal opener is unavailable.");
    opener.focus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary><button data-testid="first-modal" type="button">First</button></Boundary>
      </div>
    );
    expect(document.querySelector('[data-testid="first-modal"]')).toHaveFocus();
    rerender(
      <div>
        <button data-testid="opener" type="button">Open</button>
        <Boundary key="replacement"><button data-testid="second-modal" type="button">Second</button></Boundary>
      </div>
    );
    expect(document.querySelector('[data-testid="second-modal"]')).toHaveFocus();
    await flushFocusRestore();
    expect(document.querySelector('[data-testid="second-modal"]')).toHaveFocus();
    expect(opener).not.toHaveFocus();
  });

  it("cleans up its listener and remains single-owner under StrictMode", () => {
    const { rerender } = render(
      <StrictMode>
        <Boundary>
          <button data-testid="first" type="button">First</button>
          <button data-testid="second" type="button">Second</button>
        </Boundary>
      </StrictMode>
    );
    const first = document.querySelector<HTMLButtonElement>('[data-testid="first"]');
    if (!first) throw new Error("StrictMode test control is unavailable.");
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab" });
    expect(document.querySelector<HTMLButtonElement>('[data-testid="second"]')).toHaveFocus();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("StrictMode test modal is unavailable.");
    const removeListener = vi.spyOn(dialog, "removeEventListener");
    rerender(<Boundary open={false} />);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
