import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FavouritesPointerEnvironment } from "./ports";
import { useFavouriteReorderInteraction } from "./useFavouriteReorderInteraction";

type ListenerType = "pointermove" | "pointerup" | "pointercancel";

function createEnvironment() {
  const listeners: Array<{
    type: ListenerType;
    listener: (event: PointerEvent) => void;
    removed: boolean;
  }> = [];
  let target: Element | null = null;
  const environment: FavouritesPointerEnvironment & {
    readonly listeners: typeof listeners;
    emit: (type: ListenerType, event: PointerEvent) => void;
    setTarget: (value: Element | null) => void;
  } = {
    elementFromPoint: vi.fn(() => target),
    addWindowListener: (type, listener) => {
      const record = { type, listener, removed: false };
      listeners.push(record);
      return () => {
        record.removed = true;
      };
    },
    listeners,
    emit: (type, event) => {
      for (const record of listeners) {
        if (record.type === type && !record.removed) {
          record.listener(event);
        }
      }
    },
    setTarget: (value) => {
      target = value;
    }
  };
  return environment;
}

function pointerEvent(): PointerEvent {
  // jsdom does not expose a PointerEvent constructor in every supported runner.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return { clientX: 4, clientY: 8, preventDefault: vi.fn() } as unknown as PointerEvent;
}

describe("useFavouriteReorderInteraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rebinds active listeners to a committed replacement environment", () => {
    const first = createEnvironment();
    const second = createEnvironment();
    const firstOnReorder = vi.fn();
    const secondOnReorder = vi.fn();
    const { result, rerender } = renderHook(
      ({ environment, onReorder }: { environment: FavouritesPointerEnvironment; onReorder: (from: string, to: string) => void }) =>
        useFavouriteReorderInteraction({ environment, onReorder }),
      { initialProps: { environment: first, onReorder: firstOnReorder } }
    );

    act(() => result.current.start("from"));
    rerender({ environment: second, onReorder: secondOnReorder });
    expect(first.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    expect(second.listeners).toHaveLength(3);

    const target = document.createElement("div");
    target.dataset.favouriteKey = "to";
    second.setTarget(target);
    act(() => second.emit("pointermove", pointerEvent()));
    expect(firstOnReorder).not.toHaveBeenCalled();
    expect(secondOnReorder).toHaveBeenCalledWith("from", "to");
  });

  it.each(["pointerup", "pointercancel"] as const)("keeps one listener set when the active key starts again before %s", (terminalEvent) => {
    const environment = createEnvironment();
    const onReorder = vi.fn();
    const { result } = renderHook(() => useFavouriteReorderInteraction({ environment, onReorder }));

    act(() => result.current.start("from"));
    expect(environment.listeners).toHaveLength(3);
    act(() => result.current.start("from"));
    expect(environment.listeners).toHaveLength(3);
    expect(environment.listeners.filter(({ removed }) => !removed)).toHaveLength(3);

    const target = document.createElement("div");
    target.dataset.favouriteKey = "to";
    environment.setTarget(target);
    act(() => environment.emit("pointermove", pointerEvent()));
    expect(onReorder).toHaveBeenCalledWith("from", "to");

    act(() => environment.emit(terminalEvent, pointerEvent()));
    expect(environment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
  });

  it("cleans up on unmount and ignores late listener callbacks", () => {
    const environment = createEnvironment();
    const onReorder = vi.fn();
    const { result, unmount } = renderHook(() => useFavouriteReorderInteraction({ environment, onReorder }));
    act(() => result.current.start("from"));
    const lateMove = environment.listeners[0]?.listener;
    unmount();

    expect(environment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    const target = document.createElement("div");
    target.dataset.favouriteKey = "to";
    environment.setTarget(target);
    lateMove?.(pointerEvent());
    expect(onReorder).not.toHaveBeenCalled();
  });
});
