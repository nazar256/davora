import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  captureFocusedSelection,
  clearFocusedSelectionIfCurrent,
  createFocusedSelectionState,
  rebindFocusedSelectionIfCurrent,
  selectFocusedEntry,
  toggleFocusedEntry,
  type FocusedSelectionState
} from "./model";
import { useFocusedSelection } from "./useFocusedSelection";

const entry = (path: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false,
  ...overrides
});

describe("focused selection model", () => {
  it("rejects malformed descriptors without changing state", () => {
    const state = createFocusedSelectionState("alpha");
    expect(selectFocusedEntry(state, "alpha", entry("../escape"))).toBe(state);
    expect(selectFocusedEntry(state, "alpha", entry("notes.txt", { name: "" }))).toBe(state);
    expect(selectFocusedEntry(state, "beta", entry("notes.txt"))).toBe(state);
  });

  it("tags immutable identity and preserves monotonic versions through clear and rebind", () => {
    let state = selectFocusedEntry(createFocusedSelectionState("alpha"), "alpha", entry("notes.txt"));
    expect(state.kind).toBe("selected");
    if (state.kind !== "selected") return;
    const capture = captureFocusedSelection(state)!;
    expect(capture).toEqual({ identity: { accountId: "alpha", path: "notes.txt" }, version: 1 });
    state = clearFocusedSelectionIfCurrent(state, capture);
    state = selectFocusedEntry(state, "alpha", entry("other.txt"));
    expect(state.kind === "selected" && state.selection.version).toBe(2);
    const reboundCapture = captureFocusedSelection(state)!;
    state = rebindFocusedSelectionIfCurrent(state, reboundCapture, entry("Archive/other.txt"));
    expect(state.kind === "selected" && state.selection.identity.path).toBe("Archive/other.txt");
    expect(state.kind === "selected" && state.selection.version).toBe(2);
  });

  it("makes stale captures inert and toggles the current entry", () => {
    let state: FocusedSelectionState = createFocusedSelectionState("alpha");
    state = toggleFocusedEntry(state, "alpha", entry("one.txt"));
    const stale = captureFocusedSelection(state)!;
    state = toggleFocusedEntry(state, "alpha", entry("two.txt"));
    expect(clearFocusedSelectionIfCurrent(state, stale)).toBe(state);
    state = toggleFocusedEntry(state, "alpha", entry("two.txt"));
    expect(state.kind).toBe("empty");
  });
});

describe("useFocusedSelection", () => {
  it("masks account replacement synchronously and remains StrictMode-safe", () => {
    const { result, rerender } = renderHook(({ accountId }) => useFocusedSelection(accountId), {
      initialProps: { accountId: "alpha" },
      reactStrictMode: true
    });
    act(() => result.current.select(entry("one.txt")));
    const capture = result.current.capture();
    expect(capture?.version).toBe(1);
    rerender({ accountId: "beta" });
    expect(result.current.selectedEntry).toBeUndefined();
    act(() => result.current.select(entry("two.txt")));
    expect(result.current.selectedEntry?.path).toBe("two.txt");
    expect(result.current.capture()?.version).toBe(2);
    act(() => result.current.clearIfCurrent(capture));
    expect(result.current.selectedEntry?.path).toBe("two.txt");
  });
});
