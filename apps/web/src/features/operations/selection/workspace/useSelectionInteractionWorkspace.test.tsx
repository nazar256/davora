import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { SelectionChromePorts, SelectionTimerPorts } from "../ports";
import {
  useSelectionInteractionWorkspace,
  SelectionWorkspaceEpoch,
  type SelectionInteractionWorkspaceInput,
  type SelectionInteractionWorkspaceOutput,
  type SelectionWorkspaceEpoch as SelectionWorkspaceEpochType
} from "./index";

const entry = (path: string): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false
});

function createTimer() {
  const callbacks: Array<() => void> = [];
  const timer: SelectionTimerPorts = {
    setTimeout: vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
    clearTimeout: vi.fn()
  };
  return { callbacks, timer };
}

function createInput(overrides: Partial<SelectionInteractionWorkspaceInput> = {}) {
  const timer = createTimer();
  const epoch = SelectionWorkspaceEpoch.create();
  let currentFocused: FileEntry | undefined;
  let mobileDetailsOpen = false;
  const batchToggle = vi.fn();
  const focusedSelect = vi.fn((next: FileEntry) => {
    currentFocused = next;
  });
  const focusedClear = vi.fn(() => {
    currentFocused = undefined;
  });
  const openMobileDetails = vi.fn(() => {
    mobileDetailsOpen = true;
  });
  const closeMobileDetails = vi.fn(() => {
    mobileDetailsOpen = false;
  });
  const ports: SelectionChromePorts = {
    isNarrowScreen: () => true,
    isMobileDetailsOpen: () => mobileDetailsOpen,
    openMobileDetails,
    closeMobileDetails
  };
  const selection: SelectionInteractionWorkspaceInput["selection"] = {
      focused: {
        current: () => currentFocused,
        select: focusedSelect,
        clear: focusedClear,
        hasSelectedPreview: () => false,
        showMobileActions: vi.fn()
      },
      batch: {
        isSelected: () => false,
        toggle: batchToggle,
        clear: vi.fn()
      }
  };
  const environment: SelectionInteractionWorkspaceInput["environment"] = {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true,
      canMarkForBatchDownload: () => true,
      isSearchActive: () => false,
      getCurrentPath: () => "Projects"
  };
  const input: SelectionInteractionWorkspaceInput = {
    selection: overrides.selection ?? selection,
    environment: overrides.environment ?? environment,
    ports: overrides.ports ?? { timer: timer.timer, chrome: ports },
    epoch: overrides.epoch ?? epoch
  };
  return {
    input,
    timer,
    batchToggle,
    focusedSelect,
    focusedClear,
    openMobileDetails,
    closeMobileDetails,
    epoch
  };
}

describe("useSelectionInteractionWorkspace", () => {
  it("exposes only interaction commands and no selection state or workflow owner", () => {
    type Output = SelectionInteractionWorkspaceOutput;
    const { result } = renderHook(() => useSelectionInteractionWorkspace(createInput().input));

    expect(result.current.commands).toBeDefined();
    expect(result.current).not.toHaveProperty("focusedSelection");
    expect(result.current).not.toHaveProperty("batchSelection");
    expect(result.current).not.toHaveProperty("mutation");
    expect(result.current.commands).toEqual(expect.any(Object));
    expectTypeOf(result.current).toEqualTypeOf<Output>();
  });

  it("routes single-entry toggles through injected selection commands and mobile chrome", () => {
    const fixture = createInput();
    const { result } = renderHook(() => useSelectionInteractionWorkspace(fixture.input));
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.toggleEntrySelection(item));
    expect(fixture.focusedSelect).toHaveBeenCalledWith(item);
    expect(fixture.openMobileDetails).toHaveBeenCalledWith({ pushHistory: true });
    expect(fixture.batchToggle).not.toHaveBeenCalled();
  });

  it("captures browse/search scope when long-press completes and suppresses row open", () => {
    let path = "Projects";
    let searchActive = false;
    const fixture = createInput({
      environment: {
        isCurrentOperationHandler: () => true,
        isMarkBatchAllowed: () => true,
        canMarkForBatchDownload: () => true,
        isSearchActive: () => searchActive,
        getCurrentPath: () => path
      }
    });
    const { result } = renderHook(() => useSelectionInteractionWorkspace(fixture.input));
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.startRowLongPressSelection(item));
    expect(fixture.timer.timer.setTimeout).toHaveBeenCalledWith(expect.any(Function), 450);
    act(() => fixture.timer.callbacks[0]?.());
    expect(fixture.batchToggle).toHaveBeenCalledWith(item, { kind: "browse", folderPath: "Projects" });
    expect(result.current.commands.getRowOpenSuppressed()).toBe(true);

    result.current.commands.clearRowOpenSuppression();
    path = "Archive";
    searchActive = true;
    act(() => result.current.commands.startRowLongPressSelection(item));
    act(() => fixture.timer.callbacks[1]?.());
    expect(fixture.batchToggle).toHaveBeenLastCalledWith(item, { kind: "search", scopePath: "Archive" });
  });

  it("cancels long-press on pointer cancellation, path/query replacement, unmount, and StrictMode replay", () => {
    let path = "Projects";
    const fixture = createInput({
      environment: {
        isCurrentOperationHandler: () => true,
        isMarkBatchAllowed: () => true,
        canMarkForBatchDownload: () => true,
        isSearchActive: () => false,
        getCurrentPath: () => path
      }
    });
    const { result, rerender, unmount } = renderHook(
      () => useSelectionInteractionWorkspace(fixture.input),
      { wrapper: StrictMode }
    );
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.startRowLongPressSelection(item));
    result.current.commands.clearRowLongPressTimer();
    expect(fixture.timer.timer.clearTimeout).toHaveBeenCalled();

    act(() => result.current.commands.startRowLongPressSelection(item));
    path = "Archive";
    rerender();
    act(() => fixture.timer.callbacks.at(-1)?.());
    expect(fixture.batchToggle).not.toHaveBeenCalled();

    act(() => result.current.commands.startRowLongPressSelection(item));
    unmount();
    expect(fixture.timer.timer.clearTimeout).toHaveBeenCalled();
  });

  it("does not absorb workflow decisions when injected gates reject a delayed interaction", () => {
    let allowed = true;
    const fixture = createInput({
      environment: {
        isCurrentOperationHandler: () => allowed,
        isMarkBatchAllowed: () => allowed,
        canMarkForBatchDownload: () => allowed,
        isSearchActive: () => false,
        getCurrentPath: () => "Projects"
      }
    });
    const { result } = renderHook(() => useSelectionInteractionWorkspace(fixture.input));
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.startRowLongPressSelection(item));
    allowed = false;
    act(() => fixture.timer.callbacks[0]?.());

    expect(fixture.batchToggle).not.toHaveBeenCalled();
    expect(result.current.commands.getRowOpenSuppressed()).toBe(false);
  });

  it("rejects a pending same-path long-press from Alpha after replacement by Beta", () => {
    const alpha = createInput();
    const betaEpoch = SelectionWorkspaceEpoch.create();
    const { result, rerender } = renderHook(
      ({ epoch }: { epoch: SelectionWorkspaceEpochType }) => useSelectionInteractionWorkspace({
        ...alpha.input,
        epoch
      }),
      { initialProps: { epoch: alpha.epoch } }
    );
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.startRowLongPressSelection(item));
    rerender({ epoch: betaEpoch });
    act(() => alpha.timer.callbacks[0]?.());

    expect(alpha.batchToggle).not.toHaveBeenCalled();
    expect(result.current.commands.getRowOpenSuppressed()).toBe(false);
  });

  it("rejects Alpha's first-generation timer after Beta and a new Alpha generation return to the same path", () => {
    const alpha = createInput();
    const betaEpoch = SelectionWorkspaceEpoch.create();
    const alphaAgainEpoch = SelectionWorkspaceEpoch.create();
    const { result, rerender } = renderHook(
      ({ epoch }: { epoch: SelectionWorkspaceEpochType }) => useSelectionInteractionWorkspace({
        ...alpha.input,
        epoch
      }),
      { initialProps: { epoch: alpha.epoch } }
    );
    const item = entry("Projects/report.pdf");

    act(() => result.current.commands.startRowLongPressSelection(item));
    rerender({ epoch: betaEpoch });
    rerender({ epoch: alphaAgainEpoch });
    act(() => alpha.timer.callbacks[0]?.());

    expect(alpha.batchToggle).not.toHaveBeenCalled();
  });
});
