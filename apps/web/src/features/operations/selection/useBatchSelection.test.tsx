import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useBatchSelection } from "./useBatchSelection";

const file = (path: string): FileEntry => ({ path, name: path, isFolder: false });
const origin = { kind: "browse" as const, folderPath: "" };

describe("useBatchSelection", () => {
  it("masks the previous account synchronously and keeps versions monotonic after replacement", () => {
    const initialProps: { accountId: string | undefined } = { accountId: "alpha" };
    const { result, rerender } = renderHook(({ accountId }) => useBatchSelection(accountId), {
      initialProps
    });

    act(() => result.current.toggle(file("one.txt"), origin));
    expect(result.current.entries.map((entry) => entry.path)).toEqual(["one.txt"]);

    rerender({ accountId: "beta" });
    expect(result.current.entries).toEqual([]);
    act(() => result.current.toggle(file("two.txt"), origin));
    expect(result.current.memberships[0]?.membershipVersion).toBe(2);
  });

  it("removes only still-current captured members", () => {
    const { result } = renderHook(() => useBatchSelection("alpha"));
    act(() => {
      result.current.toggle(file("one.txt"), origin);
      result.current.toggle(file("two.txt"), origin);
    });
    const capture = result.current.capture();

    act(() => {
      result.current.toggle(file("one.txt"), origin);
      result.current.toggle(file("one.txt"), origin);
      result.current.toggle(file("three.txt"), origin);
      result.current.removeCaptured(capture);
    });

    expect(result.current.entries.map((entry) => entry.path)).toEqual(["one.txt", "three.txt"]);
  });

  it("ignores a stale account controller completion instead of replacing current account state", () => {
    const { result, rerender } = renderHook(({ accountId }) => useBatchSelection(accountId), {
      initialProps: { accountId: "alpha" }
    });
    act(() => result.current.toggle(file("alpha.txt"), origin));
    const alphaController = result.current;
    const alphaCapture = alphaController.capture();

    rerender({ accountId: "beta" });
    act(() => result.current.toggle(file("beta.txt"), origin));
    act(() => alphaController.removeCaptured(alphaCapture));

    expect(result.current.entries.map((entry) => entry.path)).toEqual(["beta.txt"]);
  });

  it("applies two batched toggles to the authoritative current state", () => {
    const { result } = renderHook(() => useBatchSelection("alpha"));

    act(() => {
      result.current.toggle(file("one.txt"), origin);
      result.current.toggle(file("one.txt"), origin);
    });

    expect(result.current.entries).toEqual([]);
  });

  it("selects all entries in one update and dedupes already-selected paths", () => {
    const { result } = renderHook(() => useBatchSelection("alpha"));
    act(() => result.current.toggle(file("one.txt"), origin));

    act(() => result.current.selectAll([file("one.txt"), file("two.txt"), file("Docs")], origin));

    expect(result.current.entries.map((entry) => entry.path)).toEqual(["one.txt", "two.txt", "Docs"]);
    expect(result.current.memberships.map((membership) => membership.membershipVersion)).toEqual([1, 2, 3]);
    expect(result.current.summary.count).toBe(3);
  });

  it("deselects only the listed paths while preserving other memberships", () => {
    const { result } = renderHook(() => useBatchSelection("alpha"));
    act(() => result.current.selectAll([file("one.txt"), file("Other/keep.txt"), file("two.txt")], origin));

    act(() => result.current.deselectPaths(["one.txt", "two.txt"]));

    expect(result.current.entries.map((entry) => entry.path)).toEqual(["Other/keep.txt"]);
    expect(result.current.memberships[0]?.membershipVersion).toBe(2);
  });

  it("ignores select-all and scoped deselect issued against a replaced account", () => {
    const { result, rerender } = renderHook(({ accountId }) => useBatchSelection(accountId), {
      initialProps: { accountId: "alpha" }
    });
    const alphaController = result.current;

    rerender({ accountId: "beta" });
    act(() => {
      alphaController.selectAll([file("stale.txt")], origin);
      alphaController.deselectPaths(["stale.txt"]);
    });

    expect(result.current.entries).toEqual([]);
  });
});
