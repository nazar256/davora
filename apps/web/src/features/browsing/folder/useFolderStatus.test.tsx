import type { FileEntry } from "@davora/shared";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FolderKey, FolderState } from "./model";
import { useFolderStatus } from "./useFolderStatus";

const key: FolderKey = { accountId: "alpha", cacheNamespace: "ns-alpha", path: "Docs" };
const contextToken = {};
const items: FileEntry[] = [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }];

describe("useFolderStatus", () => {
  it("applies folder status when state changes", () => {
    const setStatus = vi.fn();
    const clearListError = vi.fn();
    const ports = { setStatus, clearListError };

    const initialProps: { state: FolderState } = { state: { kind: "idle" } };
    const { rerender } = renderHook(({ state }: { state: FolderState }) => useFolderStatus({
      state,
      path: "Docs",
      accountName: "Work",
      token: "token-alpha",
      ports
    }), { initialProps });

    expect(setStatus).not.toHaveBeenCalled();
    expect(clearListError).not.toHaveBeenCalled();

    rerender({
      state: { completeness: "complete" as const,
        kind: "ready",
        key,
        contextToken,
        items,
        source: "live",
        message: "viewing"
      }
    });

    expect(clearListError).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith("Viewing /Docs in Work");
  });
});
