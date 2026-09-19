import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAppBarSortPanel } from "./useAppBarSortPanel";

describe("useAppBarSortPanel", () => {
  it("toggles and selects in callback-before-close order", () => {
    const onSortModeChange = vi.fn();
    const { result } = renderHook(() => useAppBarSortPanel({ onSortModeChange }));

    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    onSortModeChange.mockImplementation(() => {
      expect(result.current.open).toBe(true);
    });
    act(() => result.current.select("name-desc"));

    expect(onSortModeChange).toHaveBeenCalledWith("name-desc");
    expect(result.current.open).toBe(false);
  });

  it("keeps the panel open when the settings callback throws", () => {
    const failure = new Error("settings write failed");
    const onSortModeChange = vi.fn(() => {
      throw failure;
    });
    const { result } = renderHook(() => useAppBarSortPanel({ onSortModeChange }));

    act(() => result.current.toggle());
    expect(() => {
      act(() => result.current.select("name-desc"));
    }).toThrow(failure);
    expect(result.current.open).toBe(true);
  });

  it("routes selection to the newest callback after input changes", () => {
    const firstCallback = vi.fn();
    const { result, rerender } = renderHook(
      ({ onSortModeChange }) => useAppBarSortPanel({ onSortModeChange }),
      { initialProps: { onSortModeChange: firstCallback } }
    );
    const secondCallback = vi.fn();

    rerender({ onSortModeChange: secondCallback });

    act(() => result.current.select("size-desc"));
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith("size-desc");
  });

  it("has no lifecycle effects under StrictMode and resets only on unmount", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const onSortModeChange = vi.fn();
    const { result, unmount } = renderHook(() => useAppBarSortPanel({ onSortModeChange }), { wrapper });

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(onSortModeChange).not.toHaveBeenCalled();
    unmount();
  });
});
