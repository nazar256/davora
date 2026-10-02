import { renderHook } from "@testing-library/react";
import { act, StrictMode, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import { useFolderScrollMemory, type FolderScrollMemoryInput } from "./useFolderScrollMemory";

interface Harness {
  readonly element: HTMLElement;
  readonly fileListRef: RefObject<HTMLElement>;
}

const createHarness = (): Harness => {
  const element = document.createElement("section");
  const fileListRef: RefObject<HTMLElement> = { current: element };
  return { element, fileListRef };
};

const scrollTo = (element: HTMLElement, top: number) => {
  element.scrollTop = top;
  element.dispatchEvent(new Event("scroll"));
};

const renderMemory = (
  harness: Harness,
  viewKey: string,
  listReady: boolean
) => renderHook(
  (props: { viewKey: string; listReady: boolean }) => useFolderScrollMemory({
    fileListRef: harness.fileListRef,
    viewKey: props.viewKey,
    listReady: props.listReady
  } satisfies FolderScrollMemoryInput),
  { initialProps: { viewKey, listReady } }
);

describe("useFolderScrollMemory", () => {
  it("restores the saved position when returning to a visited folder once its list is ready", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "account-a\n/root", true);

    act(() => scrollTo(harness.element, 240));
    view.rerender({ viewKey: "account-a\n/root/child", listReady: true });
    expect(harness.element.scrollTop).toBe(0);

    scrollTo(harness.element, 80);
    view.rerender({ viewKey: "account-a\n/root", listReady: false });
    expect(harness.element.scrollTop).toBe(0);

    view.rerender({ viewKey: "account-a\n/root", listReady: true });
    expect(harness.element.scrollTop).toBe(240);
  });

  it("restores each level when navigating back up through multiple folders", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 300));
    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    scrollTo(harness.element, 60);
    view.rerender({ viewKey: "a\n/one/two/three", listReady: true });
    scrollTo(harness.element, 15);

    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    expect(harness.element.scrollTop).toBe(60);

    view.rerender({ viewKey: "a\n/one", listReady: true });
    expect(harness.element.scrollTop).toBe(300);
  });

  it("leaves a first-time folder at the top", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 500));
    view.rerender({ viewKey: "a\n/one/new", listReady: true });

    expect(harness.element.scrollTop).toBe(0);
  });

  it("waits for the returning view's list before applying the saved position", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 180));
    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    scrollTo(harness.element, 40);

    view.rerender({ viewKey: "a\n/one", listReady: false });
    view.rerender({ viewKey: "a\n/one", listReady: false });
    expect(harness.element.scrollTop).toBe(0);

    view.rerender({ viewKey: "a\n/one", listReady: true });
    expect(harness.element.scrollTop).toBe(180);
  });

  it("keeps positions isolated per view key", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "account-a\n/shared", true);

    act(() => scrollTo(harness.element, 320));
    view.rerender({ viewKey: "account-b\n/shared", listReady: true });
    expect(harness.element.scrollTop).toBe(0);

    scrollTo(harness.element, 90);
    view.rerender({ viewKey: "account-a\n/shared", listReady: true });
    expect(harness.element.scrollTop).toBe(320);

    view.rerender({ viewKey: "account-b\n/shared", listReady: true });
    expect(harness.element.scrollTop).toBe(90);
  });

  it("keeps tracking after the list element is replaced", () => {
    const harness = createHarness();
    const removeEventListener = vi.spyOn(harness.element, "removeEventListener");
    const view = renderMemory(harness, "a\n/one", true);

    const replacement = document.createElement("section");
    (harness.fileListRef as { current: HTMLElement | null }).current = replacement;
    view.rerender({ viewKey: "a\n/one", listReady: true });

    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));

    act(() => scrollTo(replacement, 140));
    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    view.rerender({ viewKey: "a\n/one", listReady: true });

    expect(replacement.scrollTop).toBe(140);
  });

  it("removes the scroll listener on unmount", () => {
    const harness = createHarness();
    const removeEventListener = vi.spyOn(harness.element, "removeEventListener");
    const view = renderMemory(harness, "a\n/one", true);

    view.unmount();

    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("restores the pre-navigation position even after the emptied list clamped the element", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 240));
    view.rerender({ viewKey: "a\n/one/two", listReady: false });
    act(() => {
      harness.element.dispatchEvent(new Event("scroll"));
    });

    view.rerender({ viewKey: "a\n/one", listReady: true });
    expect(harness.element.scrollTop).toBe(240);
  });

  it("does not reset scroll on rerenders that keep the same view key", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 210));
    view.rerender({ viewKey: "a\n/one", listReady: true });

    expect(harness.element.scrollTop).toBe(210);
  });

  it("rebinds cleanly under StrictMode replay", () => {
    const harness = createHarness();
    const addEventListener = vi.spyOn(harness.element, "addEventListener");
    const view = renderHook(
      (props: { viewKey: string; listReady: boolean }) => useFolderScrollMemory({
        fileListRef: harness.fileListRef,
        viewKey: props.viewKey,
        listReady: props.listReady
      } satisfies FolderScrollMemoryInput),
      { initialProps: { viewKey: "a\n/one", listReady: true }, wrapper: StrictMode }
    );

    expect(addEventListener.mock.calls.filter((call) => call[0] === "scroll")).toHaveLength(2);

    act(() => scrollTo(harness.element, 150));
    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    view.rerender({ viewKey: "a\n/one", listReady: true });

    expect(harness.element.scrollTop).toBe(150);
  });

  it("restores after a zero-offset departure keeps the folder at the top", () => {
    const harness = createHarness();
    const view = renderMemory(harness, "a\n/one", true);

    act(() => scrollTo(harness.element, 0));
    view.rerender({ viewKey: "a\n/one/two", listReady: true });
    act(() => scrollTo(harness.element, 100));
    view.rerender({ viewKey: "a\n/one", listReady: true });

    expect(harness.element.scrollTop).toBe(0);
  });
});
