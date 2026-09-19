import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserPwaEnvironmentPorts } from "./browserPwaPorts";
import { createBrowserPwaPorts } from "./browserPwaPorts";
import type { BrowserPwaRegistrationState } from "./useBrowserPwaRegistration";
import { useBrowserPwaRegistration } from "./useBrowserPwaRegistration";
import { useBrowserPwaRuntimePorts } from "./useBrowserPwaRuntimePorts";

vi.mock("./browserPwaPorts", () => ({
  createBrowserPwaPorts: vi.fn()
}));
vi.mock("./useBrowserPwaRegistration", () => ({
  useBrowserPwaRegistration: vi.fn()
}));

const environment: BrowserPwaEnvironmentPorts = {
  isStandalone: () => false,
  subscribeStandaloneChange: () => () => undefined,
  subscribeBeforeInstallPrompt: () => () => undefined,
  subscribeAppInstalled: () => () => undefined,
  reloadWindow: () => undefined,
  waitForControllerChangeOrTimeout: () => () => undefined
};
const registration: BrowserPwaRegistrationState = {
  needRefresh: false,
  setNeedRefresh: () => undefined,
  offlineReady: false,
  setOfflineReady: () => undefined,
  updateServiceWorker: async () => undefined
};

describe("useBrowserPwaRuntimePorts", () => {
  beforeEach(() => {
    vi.mocked(createBrowserPwaPorts).mockReset().mockReturnValue(environment);
    vi.mocked(useBrowserPwaRegistration).mockReset().mockReturnValue(registration);
  });

  it("assembles one stable structural port set for a mount", () => {
    const { result, rerender } = renderHook(() => useBrowserPwaRuntimePorts());
    const first = result.current;

    expect(useBrowserPwaRegistration).toHaveBeenCalledTimes(1);

    rerender();

    expect(createBrowserPwaPorts).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(first);
    expect(result.current).toEqual({ ...environment, ...registration });
  });
});
