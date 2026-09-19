import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAccount } from "../test/accounts";
import type { BrowsingCacheRepository } from "../features/browsing/cache";
import type { FavouritesService } from "../features/browsing/favourites";
import type { FolderSortService } from "../features/browsing/folderSort";
import type { RetentionRepository } from "../features/offline/retention";
import { createAccountRemovalRuntime } from "./createAccountRemovalRuntime";
import { createBrowserAppServices } from "./createBrowserAppServices";

const alpha = buildAccount("alpha", { displayName: "Alpha" });
const beta = buildAccount("beta", { displayName: "Beta" });
const knownAccounts = [
  { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
  { accountId: beta.id, cacheNamespace: beta.cacheNamespace }
];

function dependencies(overrides: {
  readonly transport?: { deleteConnectedAccount: (accountId: string) => Promise<void> };
  readonly retention?: Pick<RetentionRepository, "purgeAccountNamespace">;
  readonly cache?: Pick<BrowsingCacheRepository, "clearNamespaceOrThrow">;
  readonly favourites?: Pick<FavouritesService, "clear">;
  readonly folderSorts?: Pick<FolderSortService, "clearNamespace">;
} = {}) {
  return {
    accountTransport: overrides.transport ?? { deleteConnectedAccount: vi.fn(async () => undefined) },
    retentionRepository: overrides.retention ?? {
      purgeAccountNamespace: vi.fn(async () => ({
        kind: "success" as const,
        value: {
          account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
          normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 0 },
          roots: [],
          files: [],
          memberships: []
        }
      }))
    },
    browsingCache: overrides.cache ?? { clearNamespaceOrThrow: vi.fn() },
    favourites: overrides.favourites ?? { clear: vi.fn(() => ({ kind: "cleared" as const })) },
    folderSorts: overrides.folderSorts ?? { clearNamespace: vi.fn(() => ({ kind: "cleared" as const, removedCount: 0 })) }
  };
}

describe("createAccountRemovalRuntime", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 900px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it("is exposed once by the browser factory without a file/WebDAV capability", () => {
    const services = createBrowserAppServices();
    expect(services.accountRemovalRuntime).toBeDefined();
    expect(services.accountRemovalRuntime).not.toHaveProperty("retentionRepository");
    expect(services.accountRemovalRuntime).not.toHaveProperty("deleteFile");
  });

  it("forwards complete known accounts and clears only the target namespaces", async () => {
    const deps = dependencies();
    const runtime = createAccountRemovalRuntime(deps);

    await runtime.revokeRemoteAccount(alpha);
    await runtime.purgeLocalAccountData(alpha, knownAccounts);

    expect(deps.accountTransport.deleteConnectedAccount).toHaveBeenCalledWith(alpha.id);
    expect(deps.retentionRepository.purgeAccountNamespace).toHaveBeenCalledWith(
      { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      knownAccounts
    );
    expect(deps.browsingCache.clearNamespaceOrThrow).toHaveBeenCalledWith(alpha.cacheNamespace);
    expect(deps.favourites.clear).toHaveBeenCalledWith(alpha.id);
    expect(deps.folderSorts.clearNamespace).toHaveBeenCalledWith(alpha.cacheNamespace);
    expect(deps.browsingCache.clearNamespaceOrThrow).not.toHaveBeenCalledWith(beta.cacheNamespace);
    expect(deps.favourites.clear).not.toHaveBeenCalledWith(beta.id);
    expect(deps.folderSorts.clearNamespace).not.toHaveBeenCalledWith(beta.cacheNamespace);
  });

  it.each([
    ["transport", () => dependencies({ transport: { deleteConnectedAccount: vi.fn(async () => { throw new Error("transport-secret"); }) } }), "Unable to revoke remote account access."],
    ["retention", () => dependencies({ retention: { purgeAccountNamespace: vi.fn(async () => { throw new Error("retention-secret"); }) } }), "Account browser data cleanup failed."],
    ["cache", () => dependencies({ cache: { clearNamespaceOrThrow: vi.fn(() => { throw new Error("cache-secret"); }) } }), "Account browser data cleanup failed."],
    ["favourites", () => dependencies({ favourites: { clear: vi.fn(() => ({ kind: "clear-failed" as const, error: new Error("favourites-secret") })) } }), "Account browser data cleanup failed."],
    ["folderSorts", () => dependencies({ folderSorts: { clearNamespace: vi.fn(() => ({ kind: "clear-failed" as const, error: new Error("folder-sort-secret") })) } }), "Account browser data cleanup failed."]
  ])("redacts %s failures", async (_name, makeDependencies, expected) => {
    const runtime = createAccountRemovalRuntime(makeDependencies());
    const operation = _name === "transport"
      ? runtime.revokeRemoteAccount(alpha)
      : runtime.purgeLocalAccountData(alpha, knownAccounts);
    await expect(operation).rejects.toThrow(expected);
    await expect(operation).rejects.not.toThrow(/secret/);
  });
});
