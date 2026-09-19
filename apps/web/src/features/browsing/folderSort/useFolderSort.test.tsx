import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  buildFolderSortClearedMessage,
  FOLDER_SORT_CLEAR_FAILED_MESSAGE,
  FOLDER_SORT_SAVE_FAILED_MESSAGE,
  folderSortStorageKey
} from "./policy";
import { createFolderSortService } from "./service";
import { createFakeFolderSortStorage } from "./testing/fakeStorage";
import { useFolderSort, type UseFolderSortInput } from "./useFolderSort";

const createInput = (overrides: Partial<UseFolderSortInput> = {}): UseFolderSortInput => ({
  namespace: "ns-a",
  path: "Docs",
  baseline: "name-asc",
  service: createFolderSortService(createFakeFolderSortStorage()),
  persistBaseline: vi.fn(),
  announceStatus: vi.fn(),
  ...overrides
});

describe("useFolderSort", () => {
  it("starts at the baseline sort and reports the folder as unsaved", () => {
    const { result } = renderHook(() => useFolderSort(createInput()));
    expect(result.current.mode).toBe("name-asc");
    expect(result.current.saved).toBe(false);
    expect(result.current.reset.count).toBe(0);
  });

  it("saves an explicit sort choice for the current folder and persists the baseline", () => {
    const storage = createFakeFolderSortStorage();
    const input = createInput({ service: createFolderSortService(storage) });
    const { result } = renderHook(() => useFolderSort(input));

    act(() => result.current.select("size-desc"));

    expect(result.current.mode).toBe("size-desc");
    expect(result.current.saved).toBe(true);
    expect(storage.values.get(folderSortStorageKey("ns-a", "Docs"))).toBe("size-desc");
    expect(input.persistBaseline).toHaveBeenCalledWith("size-desc");
  });

  it("inherits the carried context sort for unsaved folders without persisting it", () => {
    const storage = createFakeFolderSortStorage();
    const input = createInput({ service: createFolderSortService(storage) });
    const { result, rerender } = renderHook((props: UseFolderSortInput) => useFolderSort(props), {
      initialProps: input
    });

    act(() => result.current.select("size-desc"));
    rerender({ ...input, path: "Pics" });

    expect(result.current.mode).toBe("size-desc");
    expect(result.current.saved).toBe(false);
    expect(storage.values.has(folderSortStorageKey("ns-a", "Pics"))).toBe(false);
  });

  it("promotes a saved folder sort into the carried context for later unsaved folders", () => {
    const storage = createFakeFolderSortStorage({ [folderSortStorageKey("ns-a", "Docs")]: "modified-desc" });
    const input = createInput({ service: createFolderSortService(storage) });
    const { result, rerender } = renderHook((props: UseFolderSortInput) => useFolderSort(props), {
      initialProps: { ...input, path: "Home" }
    });

    expect(result.current.mode).toBe("name-asc");

    rerender({ ...input, path: "Docs" });
    expect(result.current.mode).toBe("modified-desc");
    expect(result.current.saved).toBe(true);

    rerender({ ...input, path: "Other" });
    expect(result.current.mode).toBe("modified-desc");
    expect(result.current.saved).toBe(false);
    expect(storage.values.has(folderSortStorageKey("ns-a", "Other"))).toBe(false);
  });

  it("reloads overrides and keeps the carried context when the account namespace changes", () => {
    const storage = createFakeFolderSortStorage({ [folderSortStorageKey("ns-b", "Docs")]: "name-desc" });
    const input = createInput({ service: createFolderSortService(storage) });
    const { result, rerender } = renderHook((props: UseFolderSortInput) => useFolderSort(props), {
      initialProps: input
    });

    act(() => result.current.select("size-desc"));
    rerender({ ...input, namespace: "ns-b" });

    expect(result.current.mode).toBe("name-desc");
    expect(result.current.saved).toBe(true);
    expect(result.current.reset.count).toBe(1);

    rerender({ ...input, namespace: "ns-b", path: "Other" });
    expect(result.current.mode).toBe("name-desc");
    expect(result.current.saved).toBe(false);
  });

  it("clears only the current namespace on confirmed reset and keeps the current context sort", () => {
    const storage = createFakeFolderSortStorage({
      [folderSortStorageKey("ns-a", "Docs")]: "size-desc",
      [folderSortStorageKey("ns-a", "Pics")]: "name-desc",
      [folderSortStorageKey("ns-b", "Docs")]: "modified-asc",
      "davora-ui-settings": "{}"
    });
    const input = createInput({ service: createFolderSortService(storage) });
    const { result } = renderHook(() => useFolderSort(input));

    expect(result.current.mode).toBe("size-desc");
    expect(result.current.reset.count).toBe(2);

    act(() => result.current.reset.request());
    expect(result.current.reset.confirming).toBe(true);

    act(() => result.current.reset.confirm());

    expect(result.current.reset.confirming).toBe(false);
    expect(result.current.mode).toBe("size-desc");
    expect(result.current.saved).toBe(false);
    expect(result.current.reset.count).toBe(0);
    expect([...storage.values.keys()]).toEqual([
      folderSortStorageKey("ns-b", "Docs"),
      "davora-ui-settings"
    ]);
    expect(input.announceStatus).toHaveBeenCalledWith(buildFolderSortClearedMessage(2));
  });

  it("cancels the reset confirmation without clearing storage", () => {
    const storage = createFakeFolderSortStorage({ [folderSortStorageKey("ns-a", "Docs")]: "size-desc" });
    const { result } = renderHook(() => useFolderSort(createInput({ service: createFolderSortService(storage) })));

    act(() => result.current.reset.request());
    act(() => result.current.reset.cancel());

    expect(result.current.reset.confirming).toBe(false);
    expect(result.current.saved).toBe(true);
    expect(storage.values.size).toBe(1);
  });

  it("applies the sort for the session and reports failure when the write fails", () => {
    const storage = createFakeFolderSortStorage({}, { failWrite: true });
    const input = createInput({ service: createFolderSortService(storage) });
    const { result } = renderHook(() => useFolderSort(input));

    act(() => result.current.select("size-desc"));

    expect(result.current.mode).toBe("size-desc");
    expect(result.current.saved).toBe(false);
    expect(input.persistBaseline).not.toHaveBeenCalled();
    expect(input.announceStatus).toHaveBeenCalledWith(FOLDER_SORT_SAVE_FAILED_MESSAGE);
  });

  it("reports clear failures and keeps stored overrides", () => {
    const storage = createFakeFolderSortStorage(
      { [folderSortStorageKey("ns-a", "Docs")]: "size-desc" },
      { failDelete: true }
    );
    const input = createInput({ service: createFolderSortService(storage) });
    const { result } = renderHook(() => useFolderSort(input));

    act(() => result.current.reset.request());
    act(() => result.current.reset.confirm());

    expect(result.current.saved).toBe(true);
    expect(storage.values.size).toBe(1);
    expect(input.announceStatus).toHaveBeenCalledWith(FOLDER_SORT_CLEAR_FAILED_MESSAGE);
  });

  it("falls back to baseline persistence when no account namespace is active", () => {
    const input = createInput({ namespace: undefined });
    const { result } = renderHook(() => useFolderSort(input));

    act(() => result.current.select("size-asc"));

    expect(result.current.mode).toBe("size-asc");
    expect(result.current.saved).toBe(false);
    expect(input.persistBaseline).toHaveBeenCalledWith("size-asc");
  });

  it("converges saved sorts without extra renders under StrictMode", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const storage = createFakeFolderSortStorage({ [folderSortStorageKey("ns-a", "Docs")]: "size-asc" });
    const { result } = renderHook(() => useFolderSort(createInput({ service: createFolderSortService(storage) })), { wrapper });

    expect(result.current.mode).toBe("size-asc");
    expect(result.current.saved).toBe(true);
  });
});
