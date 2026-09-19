import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PwaRuntimePorts } from "../ports";
import type { PwaPromptState } from "../usePwaPromptState";
import { usePwaPromptState } from "../usePwaPromptState";
import { usePwaWorkspace } from "./usePwaWorkspace";

vi.mock("../usePwaPromptState", () => ({
  usePwaPromptState: vi.fn()
}));

const promptState: PwaPromptState = {
  installAvailable: true,
  installing: false,
  reloading: true,
  needRefresh: true,
  dismissUpdatePrompt: vi.fn(),
  installApp: vi.fn(async () => undefined),
  reloadApp: vi.fn(async () => undefined)
};
const ports: PwaRuntimePorts = {
  isStandalone: () => false,
  subscribeStandaloneChange: () => () => undefined,
  subscribeBeforeInstallPrompt: () => () => undefined,
  subscribeAppInstalled: () => () => undefined,
  reloadWindow: () => undefined,
  waitForControllerChangeOrTimeout: () => () => undefined,
  needRefresh: false,
  setNeedRefresh: () => undefined,
  offlineReady: false,
  setOfflineReady: () => undefined,
  updateServiceWorker: async () => undefined
};

describe("usePwaWorkspace", () => {
  it("projects only install and reload presentation bindings", () => {
    vi.mocked(usePwaPromptState).mockReturnValue(promptState);
    const { result } = renderHook(() => usePwaWorkspace(ports));

    expect(result.current.install.available).toBe(true);
    expect(result.current.install.busy).toBe(false);
    expect(result.current.reloadPrompt).toEqual({
      needRefresh: true,
      onDismiss: promptState.dismissUpdatePrompt,
      onReload: promptState.reloadApp,
      reloading: true
    });

    result.current.install.onInstall();
    expect(promptState.installApp).toHaveBeenCalledTimes(1);
  });
});
