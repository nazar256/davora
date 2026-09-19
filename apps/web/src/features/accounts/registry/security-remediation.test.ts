import { del, get, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../test/accounts";
import { createDeferred } from "../../../test/primitives";
import type { ConnectedAccount } from "@davora/shared";
import {
  createAccountRegistryService,
  type AccountRegistryService,
  type AccountRegistryStorage
} from "./service";
import {
  createOpenedFileRepository,
  openedFileBlobKey,
  openedFileIndexKey,
  type RetentionResultShape,
  type RetentionSnapshotShape
} from "../../../platform/storage/openedFileRepository";

const storage = (initial: string | null = null): AccountRegistryStorage & { value: string | null } => ({
  value: initial,
  readItem: vi.fn(function (this: { value: string | null }) {
    return { ok: true as const, value: this.value };
  }),
  writeItem: vi.fn(function (this: { value: string | null }, _key: string, value: string) {
    this.value = value;
    return { ok: true as const, value: undefined };
  }),
  deleteItem: vi.fn(function (this: { value: string | null }) {
    this.value = null;
    return { ok: true as const, value: undefined };
  })
});

type SecurityRemovalPorts = {
  quiesceAccount(account: ConnectedAccount): Promise<void>;
  revokeRemoteAccount(accountId: string): Promise<void>;
  purgeLocalAccountData(account: ConnectedAccount): Promise<void>;
};
type PurgeableRepository = ReturnType<typeof createOpenedFileRepository> & {
  purgeAccountNamespace(account: { readonly accountId: string; readonly cacheNamespace: string }, knownAccounts?: readonly { readonly accountId: string; readonly cacheNamespace: string }[]): Promise<RetentionResultShape<RetentionSnapshotShape>>;
};

function isPurgeableRepository(repository: ReturnType<typeof createOpenedFileRepository>): repository is PurgeableRepository {
  return "purgeAccountNamespace" in repository && typeof repository.purgeAccountNamespace === "function";
}

const removalPorts = (overrides: Partial<SecurityRemovalPorts> = {}): SecurityRemovalPorts => {
  const quiesceAccount = overrides.quiesceAccount ?? vi.fn(async () => undefined);
  const revokeRemoteAccount = overrides.revokeRemoteAccount ?? vi.fn(async () => undefined);
  const purgeLocalAccountData = overrides.purgeLocalAccountData ?? vi.fn(async () => undefined);
  return {
    quiesceAccount,
    revokeRemoteAccount,
    purgeLocalAccountData
  };
};

const accountRequest = (account: ReturnType<typeof buildAccount>) => ({
  accountId: account.id,
  cacheNamespace: account.cacheNamespace,
  type: account.type,
  baseUrl: account.baseUrl,
  username: account.username,
  appPassword: "redacted-test-password"
});

describe("account security remediation contracts", () => {
  it("persists a revoke-pending removal and resumes revoke then purge after reload", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    expect(service.commitConnectedAccount(alpha)).toMatchObject({ kind: "committed" });
    const order: string[] = [];
    const ports = removalPorts({
      quiesceAccount: vi.fn(async () => { order.push("quiesce"); }),
      revokeRemoteAccount: vi.fn(async () => {
        order.push("revoke");
        throw new Error("remote-secret");
      }),
      purgeLocalAccountData: vi.fn(async () => { order.push("purge"); })
    });

    const first = await service.removeAccount(alpha.id, ports);

    expect(first).toMatchObject({ kind: "pending", phase: "revoke", snapshot: { accounts: [{ account: alpha }] } });
    expect(order).toEqual(["quiesce", "revoke"]);
    expect(ports.purgeLocalAccountData).not.toHaveBeenCalled();
    expect(JSON.parse(store.value ?? "{}"))
      .toMatchObject({ accounts: [{ account: alpha, pendingRemoval: { phase: "revoke" } }] });

    const reloaded = createAccountRegistryService(store);
    const retryPorts = removalPorts({
      quiesceAccount: vi.fn(async () => { order.push("quiesce-retry"); }),
      revokeRemoteAccount: vi.fn(async () => { order.push("revoke-retry"); }),
      purgeLocalAccountData: vi.fn(async () => { order.push("purge-retry"); })
    });
    const resumed = await reloaded.removeAccount(alpha.id, retryPorts);

    expect(resumed).toMatchObject({ kind: "committed", snapshot: { accounts: [] } });
    expect(order).toEqual(["quiesce", "revoke", "quiesce-retry", "revoke-retry", "purge-retry"]);
    expect(JSON.parse(store.value ?? "{}")).toEqual({ accounts: [] });
  });

  it("keeps remote-revocation failure management-visible and retryable without local success", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const revokeRemoteAccount = vi.fn(async () => { throw new Error("browser-secret"); });

    const outcome = await service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount }));

    expect(outcome).toMatchObject({ kind: "pending", phase: "revoke", snapshot: { accounts: [{ account: alpha }] } });
    expect(revokeRemoteAccount).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outcome)).not.toContain("browser-secret");
    expect(service.getSnapshot()).toMatchObject({ accounts: [{ account: alpha, pendingRemoval: { phase: "revoke" } }] });
  });

  it("revokes remote authority before local purge and keeps a purge failure pending for retry", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const order: string[] = [];
    const purgeLocalAccountData = vi.fn()
      .mockImplementationOnce(async () => {
        order.push("purge");
        throw new Error("quota-secret");
      })
      .mockImplementationOnce(async () => { order.push("purge-retry"); });
    const ports = removalPorts({
      quiesceAccount: vi.fn(async () => { order.push("quiesce"); }),
      revokeRemoteAccount: vi.fn(async () => { order.push("revoke"); }),
      purgeLocalAccountData
    });

    const pending = await service.removeAccount(alpha.id, ports);

    expect(pending).toMatchObject({ kind: "pending", phase: "purge", snapshot: { accounts: [{ account: alpha }] } });
    expect(order).toEqual(["quiesce", "revoke", "purge"]);
    expect(service.getSnapshot()).toMatchObject({ accounts: [{ account: alpha, pendingRemoval: { phase: "purge" } }] });

    const retried = await service.removeAccount(alpha.id, ports);
    expect(retried).toMatchObject({ kind: "committed", snapshot: { accounts: [] } });
    expect(order).toEqual(["quiesce", "revoke", "purge", "purge-retry"]);
  });

  it("does not let a deferred reconnect activate A after switching to B", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    service.commitConnectedAccount(beta);
    const deferred = createDeferred<Awaited<ReturnType<Parameters<AccountRegistryService["connectAccount"]>[1]>>>();
    const reconnecting = service.connectAccount(accountRequest(alpha), vi.fn(() => deferred.promise));

    expect(service.switchAccount(beta.id)).toMatchObject({ kind: "committed" });
    deferred.resolve({ kind: "http-success", data: { account: buildAccount("alpha", { displayName: "Reconnected Alpha" }) } });
    const outcome = await reconnecting;

    expect(outcome).not.toMatchObject({ kind: "committed" });
    expect(service.getSnapshot().activeAccountId).toBe(beta.id);
  });

  it("does not resurrect A when a deferred reconnect resolves after A removal", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    const deferred = createDeferred<Awaited<ReturnType<Parameters<AccountRegistryService["connectAccount"]>[1]>>>();
    const reconnecting = service.connectAccount(accountRequest(alpha), vi.fn(() => deferred.promise));
    const revokeRemoteAccount = vi.fn(async () => undefined);
    const removing = service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount }));

    await expect(removing).resolves.toMatchObject({ kind: "committed", snapshot: { accounts: [] } });
    deferred.resolve({ kind: "http-success", data: { account: alpha } });
    await reconnecting;

    expect(revokeRemoteAccount).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().accounts).toEqual([]);
  });

  it("activates a newly added B account and leaves connect modal closure to the successful outcome", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);

    const outcome = await service.connectAccount({
      type: beta.type,
      baseUrl: beta.baseUrl,
      username: beta.username,
      appPassword: "redacted-test-password"
    }, vi.fn(async () => ({ kind: "http-success" as const, data: { account: beta } })));

    expect(outcome).toMatchObject({ kind: "committed", account: beta, snapshot: { activeAccountId: beta.id } });
    expect(service.getSnapshot().activeAccountId).toBe(beta.id);
  });
});

describe("opened-file account namespace purge", () => {
  const account = { accountId: "alpha", cacheNamespace: "alpha" };
  const otherAccount = { accountId: "beta", cacheNamespace: "beta" };
  const indexKey = openedFileIndexKey;
  const blobKey = openedFileBlobKey;
  const legacyIndexKey = (namespace: string) => `davora-opened-file:index:${namespace}`;

  const clearSeededKeys = async () => {
    await Promise.all([
      del(indexKey("alpha")),
      del(indexKey("beta")),
      del(indexKey("alpha-extra")),
      del(`${legacyIndexKey("alpha")}:orphan`),
      del(blobKey("alpha", "normal.txt")),
      del(blobKey("alpha", "retained.txt")),
      del(blobKey("alpha", "orphan.txt")),
      del(blobKey("beta", "other.txt")),
      del(blobKey("alpha-extra", "keep.txt"))
    ]);
  };

  beforeEach(clearSeededKeys);
  afterEach(clearSeededKeys);

  it("purges normal, retained, and orphaned A data without touching B or similarly prefixed namespaces", async () => {
    const repository = createOpenedFileRepository();
    const retained = await repository.beginRoot(account, { rootPath: "kept", rootName: "kept", kind: "folder", folderRoots: [] });
    expect(retained.kind).toBe("success");
    if (retained.kind !== "success") return;
    const rootId = retained.value.roots[0]?.id;
    if (!rootId) throw new Error("retained root was not created");
    const blob = new Blob(["private"]);
    await repository.persistRetainedFile(account, {
      rootId,
      file: { path: "retained.txt", name: "retained.txt", mimeType: "text/plain", size: blob.size, blobSize: blob.size, readable: true, normalCacheOwnership: "none" },
      blob
    });
    await repository.writePreview(account, {
      file: { path: "normal.txt", name: "normal.txt", mimeType: "text/plain", size: blob.size, blobSize: blob.size, readable: true, normalCacheOwnership: "owned" },
      blob
    });
    await set(blobKey("alpha", "orphan.txt"), new Blob(["orphan"]));
    await set(`${legacyIndexKey("alpha")}:orphan`, { orphan: true });
    await set(blobKey("alpha-extra", "keep.txt"), new Blob(["keep"]));
    await set(indexKey("alpha-extra"), { keep: true });
    await repository.writePreview(otherAccount, {
      file: { path: "other.txt", name: "other.txt", mimeType: "text/plain", size: blob.size, blobSize: blob.size, readable: true, normalCacheOwnership: "owned" },
      blob
    });

    if (!isPurgeableRepository(repository)) {
      throw new Error("Opened-file repository does not expose account namespace purge.");
    }
    const purge = await repository.purgeAccountNamespace(account);

    expect(purge).toMatchObject({ kind: "success" });
    expect(await get(indexKey("alpha"))).toBeUndefined();
    expect(await get(blobKey("alpha", "normal.txt"))).toBeUndefined();
    expect(await get(blobKey("alpha", "retained.txt"))).toBeUndefined();
    expect(await get(blobKey("alpha", "orphan.txt"))).toBeUndefined();
    expect(await get(`${legacyIndexKey("alpha")}:orphan`)).toBeUndefined();
    expect(await get(indexKey("beta"))).toBeDefined();
    expect(await get(blobKey("beta", "other.txt"))).toBeDefined();
    expect(await get(indexKey("alpha-extra"))).toEqual({ keep: true });
    expect(await get(blobKey("alpha-extra", "keep.txt"))).toBeDefined();
    await del(indexKey("alpha-extra"));
    await del(blobKey("alpha-extra", "keep.txt"));
  });
});
