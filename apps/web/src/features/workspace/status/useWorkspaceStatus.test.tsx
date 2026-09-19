import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useWorkspaceStatus } from "./useWorkspaceStatus";

describe("useWorkspaceStatus", () => {
  it("consumes the initial message once and keeps the latest announcement", () => {
    const { result, rerender } = renderHook(({ initialMessage }) => useWorkspaceStatus({ initialMessage }), {
      initialProps: { initialMessage: "initial" }
    });

    act(() => result.current.commands.announce("announced"));
    rerender({ initialMessage: "replacement input" });

    expect(result.current.snapshot.message).toBe("announced");
  });

  it("keeps commands stable and preserves same-turn last-writer order", () => {
    const { result, unmount } = renderHook(() => useWorkspaceStatus({ initialMessage: "initial" }), {
      wrapper: StrictMode
    });
    const commands = result.current.commands;

    act(() => {
      commands.announce("first");
      commands.announce("second");
    });

    expect(result.current.commands).toBe(commands);
    expect(result.current.snapshot.message).toBe("second");
    unmount();
  });
});
