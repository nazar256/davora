import type { ConnectedAccount } from "@davora/shared";

import type { AccountTransport } from "../features/accounts/transport";
import type { BrowsingCacheRepository } from "../features/browsing/cache";
import type { FavouritesService } from "../features/browsing/favourites";
import type { FolderSortService } from "../features/browsing/folderSort";
import type { RetentionAccount, RetentionRepository } from "../features/offline/retention";
import type { ExplicitOfflineModeStorage } from "../platform/storage/browserExplicitOfflineModeStorage";
import type { AccountPlaybackCleanupPort } from "../platform/storage/browserAccountPlaybackCleanup";

export interface AccountRemovalRuntimePort {
  revokeRemoteAccount(account: ConnectedAccount): Promise<void>;
  purgeLocalAccountData(
    target: ConnectedAccount,
    knownAccounts: readonly RetentionAccount[]
  ): Promise<void>;
}

export interface AccountRemovalRuntimeDependencies {
  readonly accountTransport: Pick<AccountTransport, "deleteConnectedAccount">;
  readonly retentionRepository: Pick<RetentionRepository, "purgeAccountNamespace">;
  readonly browsingCache: Pick<BrowsingCacheRepository, "clearNamespaceOrThrow">;
  readonly favourites: Pick<FavouritesService, "clear">;
  readonly folderSorts: Pick<FolderSortService, "clearNamespace">;
  readonly explicitOfflineMode: Pick<ExplicitOfflineModeStorage, "commit">;
  readonly playbackCleanup: AccountPlaybackCleanupPort;
}

const REMOTE_REVOKE_FAILURE = "Unable to revoke remote account access.";
const LOCAL_PURGE_FAILURE = "Account browser data cleanup failed.";

export function createAccountRemovalRuntime(
  dependencies: AccountRemovalRuntimeDependencies
): AccountRemovalRuntimePort {
  return {
    async revokeRemoteAccount(account) {
      try {
        await dependencies.accountTransport.deleteConnectedAccount(account.id);
      } catch {
        throw new Error(REMOTE_REVOKE_FAILURE);
      }
    },

    async purgeLocalAccountData(target, knownAccounts) {
      try {
        const retained = await dependencies.retentionRepository.purgeAccountNamespace(
          { accountId: target.id, cacheNamespace: target.cacheNamespace },
          knownAccounts
        );
        if (retained.kind === "failure") {
          throw new Error(LOCAL_PURGE_FAILURE);
        }
        dependencies.browsingCache.clearNamespaceOrThrow(target.cacheNamespace);
        if (dependencies.favourites.clear(target.id).kind === "clear-failed") {
          throw new Error(LOCAL_PURGE_FAILURE);
        }
        if (dependencies.folderSorts.clearNamespace(target.cacheNamespace).kind === "clear-failed") {
          throw new Error(LOCAL_PURGE_FAILURE);
        }
        if (dependencies.explicitOfflineMode.commit(target.id, false).kind === "failed") {
          throw new Error(LOCAL_PURGE_FAILURE);
        }
        dependencies.playbackCleanup.purgeAccount(target.id, knownAccounts.map((account) => account.accountId));
      } catch {
        throw new Error(LOCAL_PURGE_FAILURE);
      }
    }
  };
}
