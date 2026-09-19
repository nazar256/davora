import { describe, expect, it } from "vitest";

import { buildAccount, buildSession } from "../../../test/accounts";
import type { AccountRegistrySnapshot, AccountRegistryState } from "../registry";
import { projectAccountStateWorkspaceSnapshot } from "./model";

function state(overrides: Partial<{ kind: "ready" | "repaired"; snapshot: AccountRegistrySnapshot; warning?: string }> = {}): AccountRegistryState {
  return {
    kind: "ready",
    snapshot: { accounts: [] },
    ...overrides
  };
}

describe("projectAccountStateWorkspaceSnapshot", () => {
  it("keeps the exact initial status with zero accounts", () => {
    expect(projectAccountStateWorkspaceSnapshot(state()).initialStatus).toBe("Connect an account to begin.");
  });

  it("keeps the exact initial status while restoring accounts", () => {
    const account = buildAccount("alpha");
    expect(projectAccountStateWorkspaceSnapshot(state({
      snapshot: { accounts: [{ account, session: buildSession(account) }] }
    })).initialStatus).toBe("Restoring account state…");
  });

  it("keeps management selection while falling back operationally from pending removal", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const snapshot = projectAccountStateWorkspaceSnapshot(state({
      snapshot: {
        activeAccountId: "alpha",
        accounts: [
          { account: alpha, session: buildSession(alpha), pendingRemoval: { phase: "revoke" } },
          { account: beta, session: buildSession(beta) }
        ]
      }
    }));

    expect(snapshot.managementActiveAccount?.id).toBe("alpha");
    expect(snapshot.operationalActiveAccount?.id).toBe("beta");
    expect(snapshot.pendingRemovalAccounts).toEqual([{ account: alpha, phase: "revoke" }]);
    expect(snapshot.bootstrapSafeHost).toBe("beta.example.com");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.accounts)).toBe(true);
  });

  it("exposes all-pending records without an operational account", () => {
    const account = buildAccount("alpha");
    const snapshot = projectAccountStateWorkspaceSnapshot(state({
      snapshot: { activeAccountId: account.id, accounts: [{ account, pendingRemoval: { phase: "purge" } }] }
    }));

    expect(snapshot.totalAccountCount).toBe(1);
    expect(snapshot.accountCount).toBe(0);
    expect(snapshot.managementActiveAccount?.id).toBe(account.id);
    expect(snapshot.operationalActiveAccount).toBeUndefined();
    expect(snapshot.initialStatus).toBe("Restoring account state…");
  });

  it("projects unavailable and warning precedence without exposing credentials", () => {
    const unavailable = projectAccountStateWorkspaceSnapshot({
      kind: "unavailable",
      snapshot: { accounts: [] },
      message: "Saved account data is unavailable."
    });
    expect(unavailable.registryUnavailable).toBe(true);
    expect(unavailable.registryNotice).toBe(unavailable.initialStatus);

    const warning = projectAccountStateWorkspaceSnapshot(state({
      warning: "Saved account data was repaired.",
      snapshot: { accounts: [{ account: buildAccount("alpha"), session: { token: "sentinel-token", expiresAt: "2099-01-01", rootPath: ".davora-agent-test", capabilities: buildSession(buildAccount("alpha")).capabilities } }] }
    }));
    expect(warning.registryNotice).toBe("Saved account data was repaired.");
    expect(JSON.stringify(warning)).not.toContain("sentinel-token");
  });
});
