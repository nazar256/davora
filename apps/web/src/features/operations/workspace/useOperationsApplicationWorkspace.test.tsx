import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SelectionInteractionWorkspaceInput } from "../selection";
import type {
  OperationAuthorityWorkspaceInput,
  OperationExecutionWorkspaceInput,
  OperationsApplicationWorkspaceInput
} from "./ports";

const mocks = vi.hoisted(() => ({
  useOperationAuthorityWorkspace: vi.fn<(input: OperationAuthorityWorkspaceInput) => unknown>(),
  useSelectionInteractionWorkspace: vi.fn<(input: SelectionInteractionWorkspaceInput) => unknown>(),
  useOperationExecutionWorkspace: vi.fn<(input: OperationExecutionWorkspaceInput) => unknown>()
}));

vi.mock("./useOperationAuthorityWorkspace", () => ({ useOperationAuthorityWorkspace: mocks.useOperationAuthorityWorkspace }));
vi.mock("../selection", () => ({ useSelectionInteractionWorkspace: mocks.useSelectionInteractionWorkspace }));
vi.mock("./index", () => ({ useOperationExecutionWorkspace: mocks.useOperationExecutionWorkspace }));

import { useOperationsApplicationWorkspace } from "./useOperationsApplicationWorkspace";

describe("useOperationsApplicationWorkspace", () => {
  const authority = {
    isCurrentOperationHandler: vi.fn(() => true),
    isOperationAllowed: vi.fn(() => true)
  };
  const interaction = { clearBatchSelection: vi.fn(), marker: "interaction" };
  const execution = { marker: "execution" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useOperationAuthorityWorkspace.mockReturnValue(authority);
    mocks.useSelectionInteractionWorkspace.mockReturnValue({ commands: interaction });
    mocks.useOperationExecutionWorkspace.mockReturnValue(execution);
  });

  it("composes authority, interaction, and execution in order with exact public capabilities", () => {
    let selectedPreview: { path: string; name: string } | undefined;
    const input = createInput("alpha", () => selectedPreview);
    const { result } = renderHook(() => useOperationsApplicationWorkspace(input));

    expect(result.current).toEqual({ authority, interaction, execution });
    expect(mocks.useOperationAuthorityWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.useSelectionInteractionWorkspace.mock.invocationCallOrder[0]);
    expect(mocks.useSelectionInteractionWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.useOperationExecutionWorkspace.mock.invocationCallOrder[0]);
    expect(mocks.useOperationAuthorityWorkspace).toHaveBeenCalledWith({
      context: input.context,
      createAbortHandle: input.ports.createAbortHandle
    });

    const interactionInput = mocks.useSelectionInteractionWorkspace.mock.calls[0][0];
    expect(interactionInput.selection.focused.current).toBe(input.selection.focused.current);
    expect(interactionInput.selection.batch.toggle).toBe(input.selection.batch.toggle);
    expect(interactionInput.ports.timer).toBe(input.ports.timer);
    expect(interactionInput.ports.chrome).toBe(input.ports.chrome);
    expect(interactionInput.epoch).toBe(input.selectionEpoch);
    expect(interactionInput.selection.focused.hasSelectedPreview()).toBe(false);
    selectedPreview = { path: "/late.txt", name: "late.txt" };
    expect(interactionInput.selection.focused.hasSelectedPreview()).toBe(true);
    expect(interactionInput.environment.getCurrentPath()).toBe("path-alpha");
    expect(interactionInput.environment.isSearchActive()).toBe(false);
    interactionInput.environment.isMarkBatchAllowed();
    interactionInput.environment.canMarkForBatchDownload();
    expect(authority.isOperationAllowed).toHaveBeenNthCalledWith(1, { kind: "markBatch" });
    expect(authority.isOperationAllowed).toHaveBeenNthCalledWith(2, { kind: "markBatch" });

    const executionInput = mocks.useOperationExecutionWorkspace.mock.calls[0][0];
    expect(executionInput.authority).toBe(authority);
    expect(executionInput.context).toBe(input.context);
    expect(executionInput.selection.focused).toBe(input.selection.focused);
    expect(executionInput.selection.batch).toBe(input.selection.batch);
    expect(executionInput.selection.clearBatch).toBe(interaction.clearBatchSelection);
    expect(executionInput.selection.selectedPreviewPort).toBe(input.ports.preview);
    expect(executionInput.coordination.session).toBe(input.ports.session);
    expect(executionInput.coordination.refresh.loadFolder).toBe(input.ports.refresh.loadFolder);
    expect(executionInput.coordination.refresh.getCurrentPath()).toBe("path-alpha");
    expect(executionInput.coordination.navigation.closeMobileDetails).toBe(input.ports.chrome.closeMobileDetails);
    expect(executionInput.coordination.navigation.openMobileDetails).toBe(input.ports.chrome.openMobileDetails);
    expect(executionInput.coordination.presentation).toBe(input.ports.presentation);
    expect(executionInput.coordination.transfers).toBe(input.ports.transfers);
    expect(executionInput.runtime).toBe(input.ports.runtime);
  });

  it("forwards replacement-current account, path, session, epoch, chrome, preview, and runtime inputs", () => {
    const first = createInput("alpha", () => undefined);
    const second = createInput("beta", () => ({ path: "/beta.txt", name: "beta.txt" }));
    const { rerender } = renderHook(
      ({ input }: { input: OperationsApplicationWorkspaceInput }) => useOperationsApplicationWorkspace(input),
      { initialProps: { input: first } }
    );

    rerender({ input: second });
    const authorityInput = mocks.useOperationAuthorityWorkspace.mock.calls.at(-1)?.[0];
    const interactionInput = mocks.useSelectionInteractionWorkspace.mock.calls.at(-1)?.[0];
    const executionInput = mocks.useOperationExecutionWorkspace.mock.calls.at(-1)?.[0];
    expect(authorityInput?.context).toBe(second.context);
    expect(interactionInput?.epoch).toBe(second.selectionEpoch);
    expect(interactionInput?.ports.chrome).toBe(second.ports.chrome);
    expect(interactionInput?.selection.focused.hasSelectedPreview()).toBe(true);
    expect(interactionInput?.environment.getCurrentPath()).toBe("path-beta");
    expect(interactionInput?.environment.isSearchActive()).toBe(true);
    expect(executionInput?.selection.selectedPreviewPort).toBe(second.ports.preview);
    expect(executionInput?.coordination.session).toBe(second.ports.session);
    expect(executionInput?.coordination.refresh.setCurrentPath).toBe(second.ports.refresh.setCurrentPath);
    expect(executionInput?.runtime).toBe(second.ports.runtime);
  });
});

function createInput(
  suffix: "alpha" | "beta",
  getSelectedPreview: () => { readonly path: string; readonly name: string } | undefined
): OperationsApplicationWorkspaceInput {
  const focused = {
    selectedEntry: undefined,
    current: vi.fn(), select: vi.fn(), clear: vi.fn(), clearIfCurrent: vi.fn(), rebindIfCurrent: vi.fn(), removeDeleted: vi.fn(),
    showMobileActions: vi.fn(), showMobileDetails: vi.fn(), capture: vi.fn(), isCurrent: vi.fn()
  };
  const batch = {
    entries: [], archiveInput: { roots: [], archiveLabel: "selection" }, summary: { count: 0 }, memberships: [],
    isSelected: vi.fn(), toggle: vi.fn(), clear: vi.fn(), removeDeleted: vi.fn(), rebind: vi.fn(), retain: vi.fn(), removeCaptured: vi.fn(), capture: vi.fn()
  };
  const fixture = {
    context: {
      accountId: `account-${suffix}`, accountName: suffix, token: `token-${suffix}`, capabilities: undefined,
      currentPath: `path-${suffix}`, cacheOnlyMode: false, explicitOffline: false, browserOffline: false, workerUnavailable: false, isNarrowScreen: suffix === "beta"
    },
    selection: { focused, batch },
    selectionEpoch: { marker: `epoch-${suffix}` },
    searchActive: suffix === "beta",
    ports: {
      createAbortHandle: vi.fn(),
      timer: { setTimeout: vi.fn(), clearTimeout: vi.fn() },
      chrome: { isNarrowScreen: vi.fn(), isMobileDetailsOpen: vi.fn(), openMobileDetails: vi.fn(), closeMobileDetails: vi.fn() },
      preview: { get: getSelectedPreview, set: vi.fn(), closePreview: vi.fn() },
      session: { resetActiveSession: vi.fn() },
      refresh: { setCurrentPath: vi.fn(), loadFolder: vi.fn() },
      navigation: { closeNavigation: vi.fn(), pushActionSurface: vi.fn() },
      presentation: { clearListError: vi.fn(), reportListError: vi.fn(), setStatus: vi.fn(), getAccountName: vi.fn(() => suffix), toDisplayPath: vi.fn((path: string) => path) },
      transfers: { marker: `transfers-${suffix}` },
      runtime: { marker: `runtime-${suffix}` }
    }
  };
  // Child hooks are mocked; this fixture intentionally supplies only capabilities the application owner forwards.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return fixture as unknown as OperationsApplicationWorkspaceInput;
}
