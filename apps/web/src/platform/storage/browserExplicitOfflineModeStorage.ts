import { createBrowserStringStorage, type BrowserStringStorage } from "./browserStringStorage";

export const EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY = "davora-explicit-offline-accounts";

type AccountIdsRead =
  | { readonly kind: "ready"; readonly accountIds: readonly string[]; readonly repair?: ExplicitOfflineModeStorageRepair }
  | { readonly kind: "failed"; readonly reason: "corrupt" | "unavailable"; readonly error: Error };

type ExplicitOfflineModeStorageRepair =
  | { readonly kind: "delete" }
  | { readonly kind: "write"; readonly value: string };
type ExplicitOfflineModeStorageRead =
  | { readonly kind: "ready"; readonly enabled: boolean; readonly repair?: ExplicitOfflineModeStorageRepair }
  | { readonly kind: "failed"; readonly reason: "corrupt" | "unavailable"; readonly error: Error };
type ExplicitOfflineModeStorageCommit =
  | { readonly kind: "committed" }
  | { readonly kind: "failed"; readonly reason?: "corrupt" | "unavailable"; readonly error: Error };
type ExplicitOfflineModeStorageRepairResult =
  | { readonly kind: "repaired" }
  | { readonly kind: "failed"; readonly error: Error };
export interface ExplicitOfflineModeStorage {
  read(accountId: string | undefined): ExplicitOfflineModeStorageRead;
  commit(accountId: string, enabled: boolean): ExplicitOfflineModeStorageCommit;
  reset(): ExplicitOfflineModeStorageCommit;
  repair(repair: ExplicitOfflineModeStorageRepair): ExplicitOfflineModeStorageRepairResult;
}

function storageError(message: string, error?: unknown): Error {
  return error instanceof Error ? new Error(`${message}: ${error.message}`) : new Error(message);
}

/** Pure read: malformed/corrupt persisted data fails closed and is never repaired during render. */
function readAccountIds(storage: BrowserStringStorage): AccountIdsRead {
  const result = storage.readItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY);
  if (!result.ok) {
    return { kind: "failed", reason: "unavailable", error: storageError("Explicit offline mode storage read failed", result.error) };
  }
  if (result.value === null) {
    return { kind: "ready", accountIds: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.value);
  } catch (error) {
    return { kind: "failed", reason: "corrupt", error: storageError("Explicit offline mode storage is corrupt", error) };
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || value.length === 0)) {
    return { kind: "failed", reason: "corrupt", error: new Error("Explicit offline mode storage is corrupt.") };
  }
  const accountIds = [...new Set(parsed)].sort();
  const canonical = JSON.stringify(accountIds);
  return {
    kind: "ready",
    accountIds,
    ...(canonical === result.value
      ? {}
      : accountIds.length === 0
        ? { repair: { kind: "delete" as const } }
        : { repair: { kind: "write" as const, value: canonical } })
  };
}

export function createBrowserExplicitOfflineModeStorage(
  storage: BrowserStringStorage = createBrowserStringStorage()
): ExplicitOfflineModeStorage {
  const commitRepair = (repair: ExplicitOfflineModeStorageRepair): ExplicitOfflineModeStorageRepairResult => {
    const result = repair.kind === "delete"
      ? storage.deleteItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)
      : storage.writeItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, repair.value);
    return result.ok
      ? { kind: "repaired" }
      : { kind: "failed", error: storageError("Explicit offline mode storage repair failed", result.error) };
  };

  const commit = (accountId: string, enabled: boolean): ExplicitOfflineModeStorageCommit => {
    const current = readAccountIds(storage);
    if (current.kind === "failed") {
      return { kind: "failed", reason: current.reason, error: current.error };
    }
    const accountIds = new Set(current.accountIds);
    if (enabled) {
      accountIds.add(accountId);
    } else {
      accountIds.delete(accountId);
    }
    const normalized = [...accountIds].sort();
    const result = normalized.length === 0
      ? storage.deleteItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)
      : storage.writeItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, JSON.stringify(normalized));
    return result.ok
      ? { kind: "committed" }
      : { kind: "failed", reason: "unavailable", error: storageError("Explicit offline mode storage commit failed", result.error) };
  };

  return {
    read(accountId: string | undefined): ExplicitOfflineModeStorageRead {
      const current = readAccountIds(storage);
      if (current.kind === "failed") {
        return current;
      }
      return {
        kind: "ready",
        enabled: Boolean(accountId && current.accountIds.includes(accountId)),
        ...(current.repair === undefined ? {} : { repair: current.repair })
      };
    },
    commit,
    reset(): ExplicitOfflineModeStorageCommit {
      const result = storage.deleteItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY);
      return result.ok
        ? { kind: "committed" }
        : { kind: "failed", reason: "unavailable", error: storageError("Explicit offline mode storage reset failed", result.error) };
    },
    repair: commitRepair
  };
}
