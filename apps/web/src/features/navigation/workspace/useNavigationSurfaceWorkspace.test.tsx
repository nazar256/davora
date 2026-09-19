import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createHistoryState } from "../model";
import type { HistoryPort } from "../ports";
import { useNavigationSurfaceWorkspace } from "./useNavigationSurfaceWorkspace";

const touchAt = (clientY: number) => ({ touches: [{ clientY }] });

function invoke(handler: ((...args: never[]) => unknown) | undefined, event: unknown = {}) {
  if (handler) Reflect.apply(handler, undefined, [event]);
}

describe("useNavigationSurfaceWorkspace", () => {
  it("coordinates Back and suppresses pull-to-refresh while a surface is open", () => {
    const events: string[] = [];
    let listener: ((state: unknown) => void) | undefined;
    let previewOpen = true;
    const history: HistoryPort = {
      pushState: vi.fn(),
      replaceState: vi.fn(),
      getState: () => undefined,
      getLocation: () => ({ href: "http://localhost/?path=Projects", search: "?path=Projects" }),
      subscribe: (next) => {
        listener = next;
        return () => { listener = undefined; };
      }
    };
    const refreshPath = vi.fn(async () => undefined);
    const { result, unmount } = renderHook(() => useNavigationSurfaceWorkspace({
      surface: {
        port: history,
        workflow: {
          preview: { isOpen: () => previewOpen, dismiss: () => { previewOpen = false; events.push("dismiss:preview"); } },
          action: { isOpen: () => false, dismiss: vi.fn() },
          destination: { isOpen: () => false, dismiss: vi.fn() },
          account: { isOpen: () => false, dismiss: vi.fn() },
          removeAccount: { isOpen: () => false, dismiss: vi.fn() },
          folderShortcut: { isOpen: () => false, dismiss: vi.fn() },
          reportBug: { isOpen: () => false, dismiss: vi.fn() }
        },
        navigation: {
          getCurrentPath: () => "Projects",
          getChromeSnapshot: () => ({ navigation: false, search: false, mobileDetails: false, settings: false, transfers: false, quickActions: false }),
          dismissChrome: vi.fn(),
          applyHistoryPath: (path) => { events.push(`navigate:${path}`); }
        }
      },
      pullToRefresh: {
        cacheOnlyMode: false,
        getCurrentPath: () => "Projects",
        getToken: () => "token-alpha",
        environment: { getWindowScrollY: () => 0 },
        refreshPath
      }
    }));

    act(() => {
      invoke(result.current.pullToRefresh.shell.handlers.onTouchStart, touchAt(0));
      invoke(result.current.pullToRefresh.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.pullToRefresh.shell.handlers.onTouchEnd);
    });
    expect(refreshPath).not.toHaveBeenCalled();

    act(() => listener?.(createHistoryState("alpha", "Archive")));
    expect(events).toEqual(["dismiss:preview", "navigate:Archive"]);

    act(() => {
      invoke(result.current.pullToRefresh.shell.handlers.onTouchStart, touchAt(0));
      invoke(result.current.pullToRefresh.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.pullToRefresh.shell.handlers.onTouchEnd);
    });
    expect(refreshPath).toHaveBeenCalledWith("Projects", { preferCache: false });

    unmount();
    expect(listener).toBeUndefined();
  });
});
