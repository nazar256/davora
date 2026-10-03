import type { BrowserStringStorage } from "./browserStringStorage";

export interface AccountPlaybackCleanupPort {
  purgeAccount(accountId: string, knownAccountIds: readonly string[]): void;
}

export interface AccountPlaybackCleanupDependencies {
  readonly storage: Pick<BrowserStringStorage, "listKeys" | "deleteItem">;
  readonly folderAudioKeyPrefix: (accountId: string) => string;
  readonly audioResumeKeyPrefix: (accountId: string) => string;
}

function failure(message: string, error?: unknown): Error {
  return error instanceof Error ? new Error(`${message}: ${error.message}`) : new Error(message);
}

export function createBrowserAccountPlaybackCleanup(
  dependencies: AccountPlaybackCleanupDependencies
): AccountPlaybackCleanupPort {
  const namespacePrefixes = [dependencies.folderAudioKeyPrefix, dependencies.audioResumeKeyPrefix];

  return {
    purgeAccount(accountId, knownAccountIds) {
      const accountIds = [...new Set([accountId, ...knownAccountIds])];
      const listed = dependencies.storage.listKeys();
      if (!listed.ok) {
        throw failure("Account playback storage enumeration failed", listed.error);
      }

      const keysToDelete = new Set<string>();
      for (const key of listed.value) {
        for (const prefixForAccount of namespacePrefixes) {
          if (!key.startsWith(prefixForAccount(accountId))) {
            continue;
          }
          const matchingAccountIds = accountIds.filter((candidate) => key.startsWith(prefixForAccount(candidate)));
          if (matchingAccountIds.length > 1) {
            throw new Error("Account playback storage namespace is ambiguous.");
          }
          if (matchingAccountIds[0] === accountId) {
            keysToDelete.add(key);
          }
        }
      }

      for (const key of keysToDelete) {
        const deleted = dependencies.storage.deleteItem(key);
        if (!deleted.ok) {
          throw failure("Account playback storage deletion failed", deleted.error);
        }
      }
    }
  };
}
