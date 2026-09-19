import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FolderSortResetBinding } from "../folderSort";
import type { SortMode } from "../model";
import { useAppBarSortPanel } from "./useAppBarSortPanel";

const createResetBinding = (overrides: Partial<FolderSortResetBinding> = {}): FolderSortResetBinding => ({
  confirming: false,
  count: 0,
  request: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  ...overrides
});

const createSortInput = (select: (mode: SortMode) => void = vi.fn(), reset = createResetBinding()) => ({
  sort: { select, reset }
});

describe("useAppBarSortPanel", () => {
  it("toggles and selects in callback-before-close order", () => {
    const select = vi.fn();
    const { result } = renderHook(() => useAppBarSortPanel(createSortInput(select)));

    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    select.mockImplementation(() => {
      expect(result.current.open).toBe(true);
    });
    act(() => result.current.select("name-desc"));

    expect(select).toHaveBeenCalledWith("name-desc");
    expect(result.current.open).toBe(false);
  });

  it("keeps the panel open when the sort callback throws", () => {
    const failure = new Error("sort write failed");
    const select = vi.fn(() => {
      throw failure;
    });
    const { result } = renderHook(() => useAppBarSortPanel(createSortInput(select)));

    act(() => result.current.toggle());
    expect(() => {
      act(() => result.current.select("name-desc"));
    }).toThrow(failure);
    expect(result.current.open).toBe(true);
  });

  it("routes selection to the newest sort owner after input changes", () => {
    const firstSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ input }) => useAppBarSortPanel(input),
      { initialProps: { input: createSortInput(firstSelect) } }
    );
    const secondSelect = vi.fn();

    rerender({ input: createSortInput(secondSelect) });

    act(() => result.current.select("size-desc"));
    expect(firstSelect).not.toHaveBeenCalled();
    expect(secondSelect).toHaveBeenCalledWith("size-desc");
  });

  it("mirrors the owner reset binding and closes the panel after confirm", () => {
    const reset = createResetBinding({ confirming: true, count: 3 });
    const { result } = renderHook(() => useAppBarSortPanel(createSortInput(vi.fn(), reset)));

    act(() => result.current.toggle());
    expect(result.current.reset.confirming).toBe(true);
    expect(result.current.reset.count).toBe(3);

    act(() => result.current.reset.confirm());
    expect(reset.confirm).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);

    act(() => result.current.reset.request());
    expect(reset.request).toHaveBeenCalledTimes(1);
    act(() => result.current.reset.cancel());
    expect(reset.cancel).toHaveBeenCalledTimes(1);
  });

  it("has no lifecycle effects under StrictMode and resets only on unmount", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const select = vi.fn();
    const { result, unmount } = renderHook(() => useAppBarSortPanel(createSortInput(select)), { wrapper });

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(select).not.toHaveBeenCalled();
    unmount();
  });
});
