import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../../test/accounts";
import { createAccountRemovalCommand } from "./createAccountRemovalCommand";

describe("createAccountRemovalCommand", () => {
  it("routes a normal removal once through registry and runtime with all known accounts", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const knownAccounts = [alpha, beta];
    const removeAccount = vi.fn(async (_accountId: string, ports: {
      quiesceAccount: (account: typeof alpha) => Promise<void>;
      revokeRemoteAccount: (accountId: string) => Promise<void>;
      purgeLocalAccountData: (account: typeof alpha) => Promise<void>;
    }) => {
      await ports.quiesceAccount(alpha);
      await ports.revokeRemoteAccount(alpha.id);
      await ports.purgeLocalAccountData(alpha);
      return { kind: "committed" as const, snapshot: { accounts: [] } };
    });
    const retryRemovalCommit = vi.fn(() => ({ kind: "invalid" as const, message: "unused" }));
    const quiesceAccount = vi.fn(async () => undefined);
    const revokeRemoteAccount = vi.fn(async () => undefined);
    const purgeLocalAccountData = vi.fn(async () => undefined);
    const command = createAccountRemovalCommand({
      registry: { removeAccount, retryRemovalCommit },
      runtime: { revokeRemoteAccount, purgeLocalAccountData },
      knownAccounts,
      quiesceAccount
    });

    await expect(command.removeAccount(alpha)).resolves.toMatchObject({ kind: "committed" });
    expect(removeAccount).toHaveBeenCalledTimes(1);
    expect(removeAccount).toHaveBeenCalledWith(alpha.id, expect.any(Object));
    expect(quiesceAccount).toHaveBeenCalledWith(alpha);
    expect(revokeRemoteAccount).toHaveBeenCalledWith(alpha);
    expect(purgeLocalAccountData).toHaveBeenCalledWith(alpha, [
      { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      { accountId: beta.id, cacheNamespace: beta.cacheNamespace }
    ]);
    expect(retryRemovalCommit).not.toHaveBeenCalled();
  });

  it("routes an opaque retry token only to registry retry commit", async () => {
    const alpha = buildAccount("alpha");
    const removeAccount = vi.fn();
    const retryRemovalCommit = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } }));
    const quiesceAccount = vi.fn(async () => undefined);
    const revokeRemoteAccount = vi.fn(async () => undefined);
    const purgeLocalAccountData = vi.fn(async () => undefined);
    const command = createAccountRemovalCommand({
      registry: { removeAccount, retryRemovalCommit },
      runtime: { revokeRemoteAccount, purgeLocalAccountData },
      knownAccounts: [alpha],
      quiesceAccount
    });

    await expect(command.removeAccount(alpha, "opaque-retry-token")).resolves.toMatchObject({ kind: "committed" });
    expect(retryRemovalCommit).toHaveBeenCalledTimes(1);
    expect(retryRemovalCommit).toHaveBeenCalledWith("opaque-retry-token");
    expect(removeAccount).not.toHaveBeenCalled();
    expect(quiesceAccount).not.toHaveBeenCalled();
    expect(revokeRemoteAccount).not.toHaveBeenCalled();
    expect(purgeLocalAccountData).not.toHaveBeenCalled();
  });
});
