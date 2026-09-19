import type { ConnectedAccount } from "@davora/shared";

import type { AccountRegistryService, RegistryRemovalOutcome } from "../../registry";
import type { RemoveAccountPorts } from "../../remove";

export interface AccountRemovalRuntime {
  revokeRemoteAccount(account: ConnectedAccount): Promise<void>;
  purgeLocalAccountData(
    target: ConnectedAccount,
    knownAccounts: readonly { readonly accountId: string; readonly cacheNamespace: string }[]
  ): Promise<void>;
}

export interface AccountRemovalCommandDependencies {
  readonly registry: Pick<AccountRegistryService, "removeAccount" | "retryRemovalCommit">;
  readonly runtime: AccountRemovalRuntime;
  readonly knownAccounts: readonly ConnectedAccount[];
  readonly quiesceAccount: (account: ConnectedAccount) => Promise<void>;
}

function retentionAccount(account: ConnectedAccount) {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

export function createAccountRemovalCommand(
  dependencies: AccountRemovalCommandDependencies
): RemoveAccountPorts {
  const knownRetentionAccounts = dependencies.knownAccounts.map(retentionAccount);
  return {
    removeAccount: (account, retryToken): Promise<RegistryRemovalOutcome> => {
      if (retryToken) {
        return Promise.resolve(dependencies.registry.retryRemovalCommit(retryToken));
      }
      return dependencies.registry.removeAccount(account.id, {
        quiesceAccount: dependencies.quiesceAccount,
        revokeRemoteAccount: () => dependencies.runtime.revokeRemoteAccount(account),
        purgeLocalAccountData: (target) => dependencies.runtime.purgeLocalAccountData(target, knownRetentionAccounts)
      });
    }
  };
}
