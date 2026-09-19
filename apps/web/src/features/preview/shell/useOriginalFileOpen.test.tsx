import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { OriginalFileOpenPorts, OriginalFileOpenTask } from "./ports";
import { useOriginalFileOpen } from "./useOriginalFileOpen";

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
} {
  let resolvePromise: () => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function task(): OriginalFileOpenTask & {
  readonly completionDeferred: ReturnType<typeof deferred>;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const completionDeferred = deferred();
  return {
    completion: completionDeferred.promise,
    completionDeferred,
    cancel: vi.fn()
  };
}

function ports(tasks: OriginalFileOpenTask[]): OriginalFileOpenPorts & {
  readonly startOriginalFileOpen: ReturnType<typeof vi.fn>;
} {
  return {
    startOriginalFileOpen: vi.fn(() => {
      const next = tasks.shift();
      if (!next) throw new Error("Missing original-file task fixture.");
      return next;
    })
  };
}

const initial = {
  open: true,
  accountId: "account-a",
  path: "Docs/report.pdf",
  token: "token-a"
};

describe("useOriginalFileOpen", () => {
  it.each([
    ["close", { open: false }],
    ["file replacement", { path: "Docs/other.pdf" }],
    ["account replacement", { accountId: "account-b" }],
    ["token replacement", { token: "token-b" }]
  ] as const)("cancels synchronously on %s and keeps late completion inert", async (_label, replacement) => {
    const pending = task();
    const runtime = ports([pending]);
    const { result, rerender } = renderHook(
      (input: typeof initial) => useOriginalFileOpen({ ...input, ports: runtime }),
      { initialProps: initial }
    );

    act(() => result.current.start());
    expect(result.current.opening).toBe(true);
    rerender({ ...initial, ...replacement });
    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.opening).toBe(false);

    await act(async () => pending.completionDeferred.resolve());
    expect(result.current.opening).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("cancels a prior attempt before a second attempt and ignores the first completion", async () => {
    const first = task();
    const second = task();
    const runtime = ports([first, second]);
    const { result } = renderHook(() => useOriginalFileOpen({ ...initial, ports: runtime }));

    act(() => result.current.start());
    act(() => result.current.start());
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(runtime.startOriginalFileOpen).toHaveBeenNthCalledWith(1, { path: initial.path, token: initial.token });
    expect(runtime.startOriginalFileOpen).toHaveBeenNthCalledWith(2, { path: initial.path, token: initial.token });

    await act(async () => first.completionDeferred.reject(new Error("stale failure")));
    expect(result.current.error).toBeUndefined();
    expect(result.current.opening).toBe(true);
    await act(async () => second.completionDeferred.resolve());
    expect(result.current.opening).toBe(false);
  });

  it("cancels exactly once on unmount including under StrictMode replay", () => {
    const pending = task();
    const runtime = ports([pending]);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(
      () => useOriginalFileOpen({ ...initial, ports: runtime }),
      { wrapper }
    );

    act(() => result.current.start());
    unmount();
    expect(pending.cancel).toHaveBeenCalledTimes(1);
  });

  it("publishes only the current safe failure message", async () => {
    const pending = task();
    const runtime = ports([pending]);
    const { result } = renderHook(() => useOriginalFileOpen({ ...initial, ports: runtime }));

    act(() => result.current.start());
    await act(async () => pending.completionDeferred.reject(new Error("Original file request failed with 503")));

    expect(result.current.opening).toBe(false);
    expect(result.current.error).toBe("Original file request failed with 503");
  });
});
