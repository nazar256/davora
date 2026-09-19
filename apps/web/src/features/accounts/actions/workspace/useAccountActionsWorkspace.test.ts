import { act, renderHook } from "@testing-library/react";
import { expectTypeOf, describe, expect, it, vi } from "vitest";

import {
  useAccountActionsWorkspace,
  type AccountActionsWorkspaceBridge,
  type AccountActionsWorkspaceCommands,
  type AccountActionsWorkspaceOutput,
  type AccountActionsWorkspaceSnapshot,
  type AccountActionsWorkspaceStages,
  type AccountActionsWorkspaceInput
} from "./index";

function createInput(settingsOpen = false): AccountActionsWorkspaceInput {
  return {
    activeAccount: undefined,
    activeRecord: undefined,
    healthRootPath: ".davora-agent-test",
    unlockRequired: false,
    settingsOpen,
    connect: {
      ports: {
        connectAccount: vi.fn(),
        ensureSessionForAccount: vi.fn()
      },
      onStatusChange: vi.fn()
    },
    remove: {
      command: {
        registry: {
          removeAccount: async () => ({ kind: "failed" as const, message: "unused" }),
          retryRemovalCommit: () => ({ kind: "failed" as const, message: "unused" })
        },
        runtime: {
          revokeRemoteAccount: vi.fn(async () => undefined),
          purgeLocalAccountData: vi.fn(async () => undefined)
        },
        knownAccounts: [],
        quiesceAccount: vi.fn(async () => undefined)
      },
      onStatusChange: vi.fn()
    },
    reset: {
      ports: {
        preview: { clearAccountContext: vi.fn() },
        selection: { clearFocused: vi.fn(), clearBatch: vi.fn() },
        browsing: { clearQuery: vi.fn(), clearListError: vi.fn() },
        navigation: { getLocationSearch: () => "", setPath: vi.fn(), syncPath: vi.fn(), closeMobileDetails: vi.fn() },
        transfers: { failActiveForAccount: vi.fn() },
        session: { applyTerminal: vi.fn() },
        bootstrap: { setError: vi.fn() },
        presentation: { setStatus: vi.fn() }
      }
    },
    navigation: {
      pushAccountSurface: vi.fn(),
      pushRemoveAccountSurface: vi.fn(),
      closeSettings: vi.fn()
    },
    switchActive: vi.fn()
  };
}

/**
 * Characterization contract for the account-actions composition owner.
 *
 * The public workspace is intentionally the only account-actions import here:
 * child lifecycle owners must remain hidden behind this boundary.
 */
describe("useAccountActionsWorkspace public contract", () => {
  it("exposes one semantic bridge and typed snapshots/commands, not raw setters", () => {
    type Workspace = ReturnType<typeof useAccountActionsWorkspace>;
    type ExpectedWorkspace = {
      readonly bridge: AccountActionsWorkspaceBridge;
      readonly snapshot: AccountActionsWorkspaceSnapshot;
      readonly stages: AccountActionsWorkspaceStages;
      readonly commands: AccountActionsWorkspaceCommands;
    };
    expectTypeOf<Workspace>().toEqualTypeOf<ExpectedWorkspace>();
    expectTypeOf<Workspace>().toEqualTypeOf<AccountActionsWorkspaceOutput>();
    expectTypeOf<Workspace>().not.toHaveProperty("setActiveAccountId");
    expectTypeOf<Workspace>().not.toHaveProperty("setShowAccountDialog");
    expectTypeOf<Workspace>().not.toHaveProperty("setRemoveAccountTarget");
  });

  it("keeps one bridge identity while its snapshot and dismiss method follow current state", () => {
    const { result, rerender } = renderHook((settingsOpen: boolean) => useAccountActionsWorkspace(createInput(settingsOpen)), {
      initialProps: false
    });
    const bridge = result.current.bridge;
    expect(bridge.snapshot().surface).toBe("none");

    rerender(true);
    expect(result.current.bridge).toBe(bridge);
    expect(bridge.snapshot().surface).toBe("settings");

    act(() => bridge.dismiss("connect"));
    expect(bridge.snapshot().surface).toBe("settings");
  });
});
