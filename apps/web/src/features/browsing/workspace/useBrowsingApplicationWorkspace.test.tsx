import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowsingWorkspaceInput } from "./ports";
import type { FolderLoadCoordinationInput } from "./useFolderLoadCoordination";

const mocks = vi.hoisted(() => ({
  useBrowsingWorkspace: vi.fn<(input: BrowsingWorkspaceInput) => unknown>(),
  useFolderLoadCoordination: vi.fn<(input: FolderLoadCoordinationInput) => unknown>()
}));

vi.mock("./useBrowsingWorkspace", () => ({ useBrowsingWorkspace: mocks.useBrowsingWorkspace }));
vi.mock("./useFolderLoadCoordination", () => ({ useFolderLoadCoordination: mocks.useFolderLoadCoordination }));

import { useBrowsingApplicationWorkspace } from "./useBrowsingApplicationWorkspace";
import type { BrowsingApplicationWorkspaceInput } from "./ports";

describe("useBrowsingApplicationWorkspace", () => {
  const reload = vi.fn();
  const load = { loadFolder: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBrowsingWorkspace.mockReturnValue({ commands: { reload } });
    mocks.useFolderLoadCoordination.mockReturnValue(load);
  });

  it.each([
    [{ explicitOffline: true, browserOffline: true, workerUnavailable: true }, "explicit-offline", "explicit-offline"],
    [{ explicitOffline: false, browserOffline: true, workerUnavailable: true }, "offline", "online"],
    [{ explicitOffline: false, browserOffline: false, workerUnavailable: true }, "server-unavailable", "online"],
    [{ explicitOffline: false, browserOffline: false, workerUnavailable: false }, "online", "online"]
  ] as const)("projects mode precedence %#", (mode, expectedFolder, expectedSearch) => {
    const input = createInput(mode);
    renderHook(() => useBrowsingApplicationWorkspace(input));

    const workspaceInput = mocks.useBrowsingWorkspace.mock.calls[0][0];
    expect(workspaceInput.mode).toEqual({
      folder: expectedFolder,
      search: expectedSearch,
      cacheOnly: true,
      explicitOffline: mode.explicitOffline,
      browserOffline: mode.browserOffline
    });
    expect(workspaceInput.context).toBe(input.context);
    expect(workspaceInput.settings).toBe(input.settings);
    expect(workspaceInput.offlineSource).toBe(input.offlineSource);
  });

  it("forwards session outcomes, availability, status, load authority, navigation, and replacement-current inputs", () => {
    const first = createInput({ explicitOffline: false, browserOffline: false, workerUnavailable: false });
    const second = createInput({ explicitOffline: false, browserOffline: true, workerUnavailable: false }, "beta");
    const { result, rerender } = renderHook(
      ({ input }: { input: BrowsingApplicationWorkspaceInput }) => useBrowsingApplicationWorkspace(input),
      { initialProps: { input: first } }
    );

    expect(result.current.workspace).toBe(mocks.useBrowsingWorkspace.mock.results[0].value);
    expect(result.current.load).toBe(load);
    const firstWorkspaceInput = mocks.useBrowsingWorkspace.mock.calls[0][0];
    firstWorkspaceInput.ports.session.terminate("folder", "unauthorized");
    firstWorkspaceInput.ports.session.terminate("search", "reconnect-required");
    expect(first.ports.session.resetActiveSession).toHaveBeenNthCalledWith(1, "Session expired. Create a fresh session for this account.", false);
    expect(first.ports.session.resetActiveSession).toHaveBeenNthCalledWith(2, "This account needs to be reconnected before searching.", true);
    firstWorkspaceInput.ports.availability.setWorkerUnavailable(true);
    firstWorkspaceInput.ports.presentation.setStatus("first status");
    expect(first.ports.availability.setWorkerUnavailable).toHaveBeenCalledWith(true);
    expect(first.ports.presentation.setStatus).toHaveBeenCalledWith("first status");

    const firstLoadInput = mocks.useFolderLoadCoordination.mock.calls[0][0];
    expect(firstLoadInput.authority).toEqual({ hasActiveAccount: true, cacheNamespace: "cache-alpha", token: "token-alpha", cacheOnlyMode: true });
    expect(firstLoadInput.navigation).toBe(first.ports.navigation);
    expect(firstLoadInput.reload).toBe(reload);
    expect(mocks.useBrowsingWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.useFolderLoadCoordination.mock.invocationCallOrder[0]);

    rerender({ input: second });
    const replacementWorkspaceInput = mocks.useBrowsingWorkspace.mock.calls.at(-1)?.[0];
    const replacementLoadInput = mocks.useFolderLoadCoordination.mock.calls.at(-1)?.[0];
    expect(replacementWorkspaceInput?.context).toBe(second.context);
    expect(replacementWorkspaceInput?.mode.folder).toBe("offline");
    expect(replacementWorkspaceInput?.ports).toBe(firstWorkspaceInput.ports);
    expect(replacementLoadInput?.authority).toEqual({ hasActiveAccount: true, cacheNamespace: "cache-beta", token: "token-beta", cacheOnlyMode: true });
    replacementWorkspaceInput?.ports.session.terminate("folder", "reconnect-required");
    replacementWorkspaceInput?.ports.availability.setWorkerUnavailable(false);
    replacementWorkspaceInput?.ports.presentation.setStatus("second status");
    expect(second.ports.session.resetActiveSession).toHaveBeenCalledWith("This account needs to be reconnected before browsing files.", true);
    expect(second.ports.availability.setWorkerUnavailable).toHaveBeenCalledWith(false);
    expect(second.ports.presentation.setStatus).toHaveBeenCalledWith("second status");
    expect(first.ports.session.resetActiveSession).toHaveBeenCalledTimes(2);
  });
});

function createInput(
  mode: { readonly explicitOffline: boolean; readonly browserOffline: boolean; readonly workerUnavailable: boolean },
  suffix = "alpha"
): BrowsingApplicationWorkspaceInput {
  const fixture = {
    context: { accountId: `account-${suffix}`, accountName: suffix, cacheNamespace: `cache-${suffix}`, path: `path-${suffix}`, token: `token-${suffix}` },
    mode: { cacheOnly: true, ...mode },
    settings: { showHiddenFiles: false, sortMode: "name-asc" },
    offlineSource: { folderItems: [], searchItemsFor: () => [] },
    ports: {
      folder: {},
      search: {},
      session: { resetActiveSession: vi.fn() },
      availability: { setWorkerUnavailable: vi.fn() },
      presentation: { setStatus: vi.fn() },
      navigation: { getCurrentPath: vi.fn(() => `path-${suffix}`), setCurrentPath: vi.fn() }
    }
  };
  // Child hooks are mocked; this fixture intentionally provides only capabilities observed by the application owner.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return fixture as unknown as BrowsingApplicationWorkspaceInput;
}
