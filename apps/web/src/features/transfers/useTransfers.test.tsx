import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTransfers } from "./useTransfers";

describe("useTransfers", () => {
  it("timestamps enqueue and terminal commands through the injected clock", () => {
    const values = ["2026-07-17T10:00:00Z", "2026-07-17T10:01:00Z"];
    const { result } = renderHook(() => useTransfers({ nowIso: () => values.shift() ?? "unexpected" }));

    act(() => result.current.enqueue({ id: "1", accountId: "account-a", kind: "download", label: "One" }));
    act(() => result.current.complete("1"));

    expect(result.current.tasks[0]).toMatchObject({ startedAt: "2026-07-17T10:00:00Z", finishedAt: "2026-07-17T10:01:00Z", phase: "done" });
  });
});
