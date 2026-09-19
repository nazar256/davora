// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../../test/accounts";
import type { QuickActionsWorkspaceInput } from "./ports";
import { useQuickActionsWorkspace } from "./useQuickActionsWorkspace";

function closedSurfaces(): QuickActionsWorkspaceInput["owners"]["surfaces"] {
  return {
    navigationDrawerOpen: false,
    mobileSearchOpen: false,
    mobileDetailsOpen: false,
    settingsOpen: false,
    transfersOpen: false,
    mutationSurfaceOpen: false,
    previewOpen: false,
    accountSurfaceOpen: false,
    offlineSyncOpen: false,
    selectionModeActive: false
  };
}

function buildInput(overrides: {
  readonly account?: Partial<QuickActionsWorkspaceInput["owners"]["account"]>;
  readonly navigation?: Partial<QuickActionsWorkspaceInput["owners"]["navigation"]>;
  readonly capabilities?: Partial<QuickActionsWorkspaceInput["owners"]["operation"]["capabilities"]>;
  readonly mutationBusy?: boolean;
  readonly surfaces?: Partial<QuickActionsWorkspaceInput["owners"]["surfaces"]>;
  readonly isNarrowScreen?: boolean;
} = {}): QuickActionsWorkspaceInput {
  const account = buildAccount("alpha");
  return {
    owners: {
      account: {
        operationalActiveAccount: account,
        totalAccountCount: 1,
        ...overrides.account
      },
      navigation: {
        quickActionsOpen: false,
        openChrome: vi.fn(),
        closeChrome: vi.fn(),
        ...overrides.navigation
      },
      operation: {
        capabilities: {
          canCreateFolder: true,
          canUploadFiles: true,
          canUploadFolders: true,
          ...overrides.capabilities
        },
        mutation: { state: { busy: overrides.mutationBusy ?? false } },
        commands: { openCreateFolder: vi.fn() },
        upload: { uploadFiles: vi.fn(async () => undefined) }
      },
      viewport: { isNarrowScreen: overrides.isNarrowScreen ?? true },
      surfaces: { ...closedSurfaces(), ...overrides.surfaces }
    },
    ports: { directoryUploadInputRef: vi.fn() }
  };
}

describe("useQuickActionsWorkspace", () => {
  afterEach(cleanup);

  it("exposes a collapsed binding on a narrow viewport with available actions", () => {
    const { result } = renderHook(() => useQuickActionsWorkspace(buildInput()));
    const binding = result.current.binding;
    expect(binding).toBeDefined();
    expect(binding?.props.open).toBe(false);
    expect(binding?.props.canCreateFolder).toBe(true);
    expect(binding?.props.canUploadFiles).toBe(true);
    expect(binding?.props.canUploadFolders).toBe(true);
  });

  it("omits the binding on wide viewports, without an account, and without any capability", () => {
    const wide = renderHook(() => useQuickActionsWorkspace(buildInput({ isNarrowScreen: false })));
    expect(wide.result.current.binding).toBeUndefined();

    const noAccount = renderHook(() => useQuickActionsWorkspace(buildInput({
      account: { operationalActiveAccount: undefined, totalAccountCount: 0 }
    })));
    expect(noAccount.result.current.binding).toBeUndefined();

    const noCapabilities = renderHook(() => useQuickActionsWorkspace(buildInput({
      capabilities: { canCreateFolder: false, canUploadFiles: false, canUploadFolders: false }
    })));
    expect(noCapabilities.result.current.binding).toBeUndefined();
  });

  it.each([
    "navigationDrawerOpen",
    "mobileSearchOpen",
    "mobileDetailsOpen",
    "settingsOpen",
    "transfersOpen",
    "mutationSurfaceOpen",
    "previewOpen",
    "accountSurfaceOpen",
    "offlineSyncOpen",
    "selectionModeActive"
  ] as const)("omits the binding while %s is active", (surface) => {
    const { result } = renderHook(() => useQuickActionsWorkspace(buildInput({ surfaces: { [surface]: true } })));
    expect(result.current.binding).toBeUndefined();
  });

  it("opens through navigation chrome and pushes history on toggle", () => {
    const input = buildInput();
    const { result } = renderHook(() => useQuickActionsWorkspace(input));

    act(() => result.current.binding?.props.onToggle());
    expect(input.owners.navigation.openChrome).toHaveBeenCalledWith("quick-actions");
    expect(input.owners.navigation.closeChrome).not.toHaveBeenCalled();
  });

  it("closes through navigation chrome when toggled open", () => {
    const input = buildInput({ navigation: { quickActionsOpen: true } });
    const { result } = renderHook(() => useQuickActionsWorkspace(input));

    expect(result.current.binding?.props.open).toBe(true);
    act(() => result.current.binding?.props.onToggle());
    expect(input.owners.navigation.closeChrome).toHaveBeenCalledWith("quick-actions");
    expect(input.owners.navigation.openChrome).not.toHaveBeenCalled();
  });

  it("closes the surface before invoking each action command", async () => {
    const input = buildInput({ navigation: { quickActionsOpen: true } });
    const events: string[] = [];
    vi.mocked(input.owners.navigation.closeChrome).mockImplementation(() => events.push("close"));
    vi.mocked(input.owners.operation.commands.openCreateFolder).mockImplementation(() => events.push("create-folder"));
    vi.mocked(input.owners.operation.upload.uploadFiles).mockImplementation(async () => { events.push("upload"); });
    const { result } = renderHook(() => useQuickActionsWorkspace(input));
    const binding = result.current.binding;
    if (!binding) throw new Error("expected quick-actions binding");

    await act(async () => { await binding.props.onUploadFiles([new File(["a"], "a.txt")]); });
    expect(events).toEqual(["close", "upload"]);

    events.length = 0;
    act(() => binding.props.onCreateFolder());
    expect(events).toEqual(["close", "create-folder"]);

    events.length = 0;
    await act(async () => { await binding.props.onUploadFolder([new File(["b"], "b.txt")]); });
    expect(events).toEqual(["close", "upload"]);
  });

  it("dismisses via closeChrome for scrim and Escape paths", () => {
    const input = buildInput({ navigation: { quickActionsOpen: true } });
    const { result } = renderHook(() => useQuickActionsWorkspace(input));
    act(() => result.current.binding?.props.onDismiss());
    expect(input.owners.navigation.closeChrome).toHaveBeenCalledWith("quick-actions");
  });

  it.each([
    { surface: "selectionModeActive" as const },
    { surface: "settingsOpen" as const },
    { surface: "previewOpen" as const }
  ])("auto-closes an open menu when %s activates", ({ surface }) => {
    const input = buildInput({ navigation: { quickActionsOpen: true } });
    const { rerender } = renderHook(
      ({ current }: { current: QuickActionsWorkspaceInput }) => useQuickActionsWorkspace(current),
      { initialProps: { current: input } }
    );

    const next = buildInput({ navigation: { quickActionsOpen: true }, surfaces: { [surface]: true } });
    next.owners.navigation.closeChrome = input.owners.navigation.closeChrome;
    rerender({ current: next });

    expect(input.owners.navigation.closeChrome).toHaveBeenCalledWith("quick-actions");
  });

  it("auto-closes an open menu when the viewport widens or capabilities drop", () => {
    const input = buildInput({ navigation: { quickActionsOpen: true } });
    const { rerender } = renderHook(
      ({ current }: { current: QuickActionsWorkspaceInput }) => useQuickActionsWorkspace(current),
      { initialProps: { current: input } }
    );

    const wide = buildInput({ isNarrowScreen: false, navigation: { quickActionsOpen: true } });
    wide.owners.navigation.closeChrome = input.owners.navigation.closeChrome;
    rerender({ current: wide });
    expect(input.owners.navigation.closeChrome).toHaveBeenCalledWith("quick-actions");
  });
});
