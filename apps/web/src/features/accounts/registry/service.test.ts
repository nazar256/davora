import { describe, expect, it, vi } from "vitest";

import { buildAccount, buildSession } from "../../../test/accounts";
import { createAccountRegistryService, type AccountRegistryStorage } from "./service";
import type { SemanticAccountRemovalPorts } from "./ports";

const storage = (initial: string | null = null): AccountRegistryStorage & { value: string | null } => ({
  value: initial,
  readItem: vi.fn(function (this: { value: string | null }) { return { ok: true as const, value: this.value }; }),
  writeItem: vi.fn(function (this: { value: string | null }, _key: string, value: string) { this.value = value; return { ok: true as const, value: undefined }; }),
  deleteItem: vi.fn(function (this: { value: string | null }) { this.value = null; return { ok: true as const, value: undefined }; })
});

const removalPorts = (overrides: Partial<SemanticAccountRemovalPorts> = {}): SemanticAccountRemovalPorts => ({
  quiesceAccount: vi.fn(async () => undefined),
  revokeRemoteAccount: vi.fn(async () => undefined),
  purgeLocalAccountData: vi.fn(async () => undefined),
  ...overrides
});

describe("account registry service", () => {
  it("does not write while loading and runs one deferred repair generation", () => {
    const alpha = buildAccount("alpha");
    const store = storage(JSON.stringify({ activeAccountId: "missing", accounts: [{ account: alpha }] }));
    const service = createAccountRegistryService(store, { isExpired: (value) => Date.parse(value) <= Date.parse("2026-07-23T12:00:00.000Z") });

    expect(service.getState().snapshot.activeAccountId).toBe(alpha.id);
    expect(store.writeItem).not.toHaveBeenCalled();
    expect(service.repair()).toMatchObject({ kind: "committed" });
    expect(service.repair()).toMatchObject({ kind: "committed" });
    expect(store.writeItem).toHaveBeenCalledTimes(1);
  });

  it("keeps sanitized memory when repair fails and retries on the next full commit", () => {
    const alpha = buildAccount("alpha");
    const store = storage(JSON.stringify({ accounts: [{ account: alpha, extra: true }] }));
    vi.mocked(store.writeItem).mockReturnValueOnce({ ok: false, error: new Error("secret write failure") });
    const service = createAccountRegistryService(store, { isExpired: (value) => Date.parse(value) <= Date.parse("2026-07-23T12:00:00.000Z") });

    expect(service.repair()).toMatchObject({ kind: "failed", message: "Unable to repair saved account data." });
    expect(service.getState()).toMatchObject({ kind: "repaired", warning: "Unable to repair saved account data." });
    expect(service.switchAccount(alpha.id)).toMatchObject({ kind: "committed" });
    expect(store.writeItem).toHaveBeenCalledTimes(2);
  });

  it("persists before publishing connect, switch, and session commits", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const store = storage();
    const service = createAccountRegistryService(store);
    const observed: string[] = [];
    service.subscribe(() => observed.push(service.getSnapshot().activeAccountId ?? "none"));

    expect(service.commitConnectedAccount(alpha)).toMatchObject({ kind: "committed" });
    expect(service.commitConnectedAccount(beta)).toMatchObject({ kind: "committed" });
    expect(service.switchAccount(alpha.id)).toMatchObject({ kind: "committed" });
    expect(service.commitSession(alpha.id, buildSession(alpha))).toMatchObject({ kind: "committed" });
    expect(observed).toEqual(["alpha", "beta", "alpha", "alpha"]);
  });

  it("changes nothing on failed persistence and rejects unknown or mismatched session identity", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const before = service.getSnapshot();
    vi.mocked(store.writeItem).mockReturnValue({ ok: false, error: new Error("quota password-sentinel") });

    expect(service.commitConnectedAccount(beta)).toMatchObject({ kind: "failed" });
    expect(service.switchAccount("missing")).toMatchObject({ kind: "invalid" });
    expect(service.commitSession("missing", buildSession(alpha))).toMatchObject({ kind: "invalid", reason: "unknown-account" });
    expect(service.commitSession(alpha.id, buildSession(beta))).toMatchObject({ kind: "invalid", reason: "account-mismatch" });
    expect(service.getSnapshot()).toEqual(before);
  });

  it("rejects cache-namespace collisions and incoherent session account metadata", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta", { cacheNamespace: alpha.cacheNamespace });
    const service = createAccountRegistryService(storage());
    expect(service.commitConnectedAccount(alpha)).toMatchObject({ kind: "committed" });
    expect(service.commitConnectedAccount(beta)).toMatchObject({ kind: "invalid" });

    const mismatches = [
      { account: buildAccount("alpha", { baseUrl: "https://other.example.com" }) },
      { account: buildAccount("alpha", { username: "other" }) },
      { account: buildAccount("alpha", { rootPath: "other-root" }) },
      { account: buildAccount("alpha", { backend: "nextcloud" }) },
      { rootPath: "other-root" },
      { capabilities: { ...buildSession(alpha).capabilities, backend: "nextcloud" as const } }
    ];
    for (const mismatch of mismatches) {
      expect(service.commitSession(alpha.id, { ...buildSession(alpha), ...mismatch })).toMatchObject({ kind: "invalid", reason: "account-mismatch" });
    }
  });

  it("keeps known-id switch state unchanged when persistence fails", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    service.commitConnectedAccount(beta);
    const before = service.getSnapshot();
    vi.mocked(store.writeItem).mockReturnValueOnce({ ok: false, error: new Error("quota") });
    expect(service.switchAccount(alpha.id)).toMatchObject({ kind: "failed" });
    expect(service.getSnapshot()).toEqual(before);
  });

  it("reports storage read unavailability without masquerading as empty", () => {
    const store = storage();
    vi.mocked(store.readItem).mockReturnValue({ ok: false, error: new Error("blocked") });
    const service = createAccountRegistryService(store);
    expect(service.getState()).toEqual({ kind: "unavailable", snapshot: { accounts: [] }, message: "Saved account data is unavailable." });
    expect(service.commitConnectedAccount(buildAccount("alpha"))).toMatchObject({ kind: "failed" });
  });

  it("does not contact the remote transport when registry storage is unavailable", async () => {
    const store = storage();
    vi.mocked(store.readItem).mockReturnValue({ ok: false, error: new Error("blocked") });
    const service = createAccountRegistryService(store);
    const transport = vi.fn(async () => ({ kind: "http-success" as const, data: { account: buildAccount("alpha") } }));

    await expect(service.connectAccount({
      type: "nextcloud",
      baseUrl: "https://cloud.example.com",
      username: "alpha",
      appPassword: "password-sentinel"
    }, transport)).resolves.toEqual({ kind: "failed", message: "Saved account data is unavailable.", clearCredential: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it("clears credentials after remote success when returned identity cannot be committed", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);

    const collisionPassword = "collision-password-sentinel";
    const collision = await service.connectAccount({
      type: "nextcloud",
      baseUrl: "https://cloud.example.com",
      username: "beta",
      appPassword: collisionPassword
    }, vi.fn(async () => ({ kind: "http-success" as const, data: { account: buildAccount("beta", { cacheNamespace: alpha.cacheNamespace }) } })));
    expect(collision).toEqual({
      kind: "partial",
      message: "The account connected remotely, but could not be saved in this browser.",
      clearCredential: true
    });
    const mismatchPassword = "mismatch-password-sentinel";
    const mismatch = await service.connectAccount({
      accountId: alpha.id,
      cacheNamespace: alpha.cacheNamespace,
      type: "nextcloud",
      baseUrl: alpha.baseUrl,
      username: alpha.username,
      appPassword: mismatchPassword
    }, vi.fn(async () => ({ kind: "http-success" as const, data: { account: buildAccount("other") } })));
    expect(mismatch).toEqual({
      kind: "partial",
      message: "The account connected remotely, but could not be saved in this browser.",
      clearCredential: true
    });
    expect(service.getSnapshot().accounts).toEqual([{ account: alpha }]);
    expect(JSON.stringify([collision, mismatch, service.getSnapshot(), store.value])).not.toMatch(/collision-password-sentinel|mismatch-password-sentinel/);
  });

  it("treats an unreadable 2xx response as remote success requiring credential clearing", async () => {
    const service = createAccountRegistryService(storage());
    await expect(service.connectAccount({
      type: "nextcloud",
      baseUrl: "https://cloud.example.com",
      username: "alpha",
      appPassword: "request-password-sentinel"
    }, vi.fn(async () => ({ kind: "invalid-http-success" as const })))).resolves.toEqual({
      kind: "partial",
      message: "The account connected remotely, but could not be saved in this browser.",
      clearCredential: true
    });
    expect(service.getSnapshot().accounts).toEqual([]);
  });

  it("removes in quiesce, remote-revoke, local-purge, local-commit order", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const order: string[] = [];
    const ports = removalPorts({
      quiesceAccount: vi.fn(async () => { order.push("quiesce"); }),
      revokeRemoteAccount: vi.fn(async () => { order.push("revoke"); }),
      purgeLocalAccountData: vi.fn(async () => { order.push("purge"); })
    });

    expect(await service.removeAccount(alpha.id, ports)).toMatchObject({ kind: "committed", snapshot: { accounts: [] } });
    expect(order).toEqual(["quiesce", "revoke", "purge"]);
    expect(JSON.parse(store.value ?? "{}")).toEqual({ accounts: [] });
  });

  it("keeps revoke pending when account quiescing fails", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    const ports = removalPorts({ quiesceAccount: vi.fn(async () => { throw new Error("secret cache failure"); }) });

    const outcome = await service.removeAccount(alpha.id, ports);

    expect(outcome).toMatchObject({ kind: "pending", phase: "revoke" });
    expect(service.getSnapshot().accounts[0]).toMatchObject({ account: alpha, pendingRemoval: { phase: "revoke" } });
    expect(ports.revokeRemoteAccount).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain("secret cache failure");
  });

  it("keeps purge pending when local cleanup fails after remote revoke", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    const ports = removalPorts({
      purgeLocalAccountData: vi.fn(async () => { throw new Error("token-sentinel"); })
    });

    const outcome = await service.removeAccount(alpha.id, ports);

    expect(outcome).toMatchObject({ kind: "pending", phase: "purge" });
    expect(ports.revokeRemoteAccount).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outcome)).not.toMatch(/token-sentinel|password-sentinel/);
  });

  it("reports remote failure as retryable revoke-pending state", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    const outcome = await service.removeAccount(alpha.id, removalPorts({
      revokeRemoteAccount: vi.fn(async () => { throw new Error("browser-secret-sentinel"); })
    }));

    expect(outcome).toMatchObject({ kind: "pending", phase: "revoke", snapshot: { accounts: [{ account: alpha, pendingRemoval: { phase: "revoke" } }] } });
    expect(JSON.stringify(outcome)).not.toContain("browser-secret-sentinel");
  });

  it("keeps account authority when pending-removal persistence fails", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    vi.mocked(store.writeItem).mockReturnValueOnce({ ok: false, error: new Error("quota") });
    const ports = removalPorts();

    await expect(service.removeAccount(alpha.id, ports)).resolves.toEqual({ kind: "failed", message: "Unable to save pending account removal." });
    expect(service.getSnapshot().accounts[0]?.account.id).toBe(alpha.id);
    expect(ports.revokeRemoteAccount).not.toHaveBeenCalled();
  });

  it("keeps account authority when revoke-pending persistence fails", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    vi.mocked(store.writeItem).mockReturnValueOnce({ ok: false, error: new Error("quota") });

    await expect(service.removeAccount(alpha.id, removalPorts())).resolves.toEqual({ kind: "failed", message: "Unable to save pending account removal." });
    expect(service.getSnapshot().accounts[0]?.account.id).toBe(alpha.id);
  });

  it("keeps purge pending after local cleanup failure and retries the purge", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const purgeLocalAccountData = vi.fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValueOnce(undefined);
    const ports = removalPorts({ purgeLocalAccountData });

    const outcome = await service.removeAccount(alpha.id, ports);

    expect(outcome).toMatchObject({ kind: "pending", phase: "purge", snapshot: { accounts: [{ pendingRemoval: { phase: "purge" } }] } });
    expect(await service.removeAccount(alpha.id, ports)).toMatchObject({ kind: "committed", snapshot: { accounts: [] } });
    expect(purgeLocalAccountData).toHaveBeenCalledTimes(2);
  });

  it("persists pending removal before attempting remote revoke", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    const ports = removalPorts();

    const outcome = await service.removeAccount(alpha.id, ports);
    expect(outcome).toMatchObject({ kind: "committed" });
    expect(JSON.parse(store.value ?? "{}")).toEqual({ accounts: [] });
    expect(ports.quiesceAccount).toHaveBeenCalledTimes(1);
    expect(ports.revokeRemoteAccount).toHaveBeenCalledTimes(1);
    expect(ports.purgeLocalAccountData).toHaveBeenCalledTimes(1);
  });

  it("keeps the active survivor when removal is pending", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    service.commitConnectedAccount(beta);
    service.switchAccount(beta.id);
    const removed = await service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount: vi.fn(async () => { throw new Error("remote"); }) }));
    expect(removed).toMatchObject({ kind: "pending", phase: "revoke", snapshot: { activeAccountId: beta.id } });
    expect(service.getSnapshot()).toMatchObject({ activeAccountId: beta.id, accounts: [{ account: alpha, pendingRemoval: { phase: "revoke" } }, { account: beta }] });
  });

  it("applies a pending removal to the latest peer state", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const gamma = buildAccount("gamma");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    service.commitConnectedAccount(beta);
    const removed = await service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount: vi.fn(async () => { throw new Error("remote"); }) }));
    expect(removed).toMatchObject({ kind: "pending", phase: "revoke" });

    expect(service.commitConnectedAccount(gamma)).toMatchObject({ kind: "committed" });
    expect(service.commitSession(beta.id, buildSession(beta))).toMatchObject({ kind: "committed" });
    expect(service.switchAccount(gamma.id)).toMatchObject({ kind: "committed" });
    expect(await service.removeAccount(alpha.id, removalPorts())).toMatchObject({ kind: "committed" });

    expect(service.getSnapshot()).toMatchObject({
      activeAccountId: gamma.id,
      accounts: [
        { account: beta, session: { token: buildSession(beta).token } },
        { account: gamma }
      ]
    });
  });

  it("rejects reconnecting an account while removal is pending", async () => {
    const alpha = buildAccount("alpha");
    const store = storage();
    const service = createAccountRegistryService(store);
    service.commitConnectedAccount(alpha);
    expect(await service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount: vi.fn(async () => { throw new Error("remote"); }) }))).toMatchObject({ kind: "pending", phase: "revoke" });
    expect(service.commitConnectedAccount(buildAccount("alpha", { displayName: "Reconnected Alpha" }))).toMatchObject({ kind: "invalid" });
    expect(service.getSnapshot().accounts[0]).toMatchObject({ account: alpha, pendingRemoval: { phase: "revoke" } });
  });

  it("does not let an old in-flight removal delete a reconnected same-id account", async () => {
    const alpha = buildAccount("alpha");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    let release!: () => void;
    const remote = new Promise<void>((resolve) => { release = resolve; });
    const removing = service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount: vi.fn(() => remote) }));
    const replacement = buildAccount("alpha", { displayName: "Replacement Alpha" });
    const reconnecting = service.connectAccount({
      accountId: alpha.id,
      cacheNamespace: alpha.cacheNamespace,
      type: "nextcloud",
      baseUrl: alpha.baseUrl,
      username: alpha.username,
      appPassword: "sentinel"
    }, vi.fn(async () => ({ kind: "http-success" as const, data: { account: replacement } })));
    release();
    await expect(removing).resolves.toMatchObject({ kind: "committed" });
    await expect(reconnecting).resolves.toMatchObject({ kind: "partial" });
    expect(service.getSnapshot().accounts).toEqual([]);
  });

  it("attempts a failed repair generation once and retries only through a later full commit", () => {
    const alpha = buildAccount("alpha");
    const store = storage(JSON.stringify({ activeAccountId: "missing", accounts: [{ account: alpha }] }));
    vi.mocked(store.writeItem).mockReturnValueOnce({ ok: false, error: new Error("blocked") });
    const service = createAccountRegistryService(store);
    expect(service.repair()).toMatchObject({ kind: "failed" });
    expect(service.repair()).toMatchObject({ kind: "failed" });
    expect(store.writeItem).toHaveBeenCalledTimes(1);
    expect(service.switchAccount(alpha.id)).toMatchObject({ kind: "committed" });
    expect(store.writeItem).toHaveBeenCalledTimes(2);
  });

  it("attempts a failed delete repair once", () => {
    const store = storage("not-json");
    vi.mocked(store.deleteItem).mockReturnValue({ ok: false, error: new Error("blocked") });
    const service = createAccountRegistryService(store);
    expect(service.repair()).toMatchObject({ kind: "failed" });
    expect(service.repair()).toMatchObject({ kind: "failed" });
    expect(store.deleteItem).toHaveBeenCalledTimes(1);
  });

  it("applies delayed removal to the latest snapshot and preserves concurrent peers and switch", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const gamma = buildAccount("gamma");
    const service = createAccountRegistryService(storage());
    service.commitConnectedAccount(alpha);
    service.commitConnectedAccount(beta);
    let release!: () => void;
    const remote = new Promise<void>((resolve) => { release = resolve; });
    const removing = service.removeAccount(alpha.id, removalPorts({ revokeRemoteAccount: vi.fn(() => remote) }));
    service.commitConnectedAccount(gamma);
    service.switchAccount(beta.id);
    release();

    await expect(removing).resolves.toMatchObject({ kind: "committed" });
    expect(service.getSnapshot().accounts.map((record) => record.account.id)).toEqual(["beta", "gamma"]);
    expect(service.getSnapshot().activeAccountId).toBe(beta.id);
  });
});
