import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ConnectedAccount } from "@davora/shared";

import {
  deserializePersistedAccountState,
  serializePersistedAccountState,
  type PersistedAccountRecord,
  type PersistedAccountRevocation
} from "../src/accounts/persistedAccountStateCodec";
import { AccountStoreDurableObject } from "../src/accounts/durable-object";
import { AccountRepositoryError, createAccountRepository } from "../src/accounts/repository";
import { LocalAccountStateStorage } from "../src/accounts/localAccountStorage";

const SECRET = "characterization-session-secret";
const workerArtifactDirectory = fileURLToPath(new URL("../../../.tmp/agent-artifacts/worker/", import.meta.url));

function account(id = "account-alpha", backend: ConnectedAccount["backend"] = "mock"): ConnectedAccount {
  return {
    id,
    type: "nextcloud",
    displayName: `${id} display name`,
    baseUrl: "https://mock-account.example.com",
    username: "demo-user",
    rootPath: "",
    backend,
    connectionState: "connected",
    lastValidatedAt: "2026-08-04T00:00:00.000Z",
    cacheNamespace: `${id}-cache`
  };
}

function record(id = "account-alpha", overrides: Partial<PersistedAccountRecord> = {}): PersistedAccountRecord {
  const currentAccount = account(id);
  return {
    account: currentAccount,
    accountNonce: `${id}-nonce`,
    ownerBrowserId: "browser-alpha",
    ownerBrowserSecret: "browser-secret",
    credentials: {
      baseUrl: currentAccount.baseUrl,
      username: currentAccount.username,
      appPassword: "app-password"
    },
    ...overrides
  };
}

function revocation(accountId = "account-alpha"): PersistedAccountRevocation {
  return {
    accountId,
    ownerBrowserId: "browser-alpha",
    ownerBrowserSecret: "browser-secret",
    revocationNonce: `${accountId}-revocation-nonce`,
    revision: 1
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function encryptedPayload(payload: unknown, version: 1 | 2 = 2, ivBytes = 12) {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = Uint8Array.from({ length: ivBytes }, (_, index) => index + 1);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { version, algorithm: "AES-GCM" as const, iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
}

describe("strict persisted account-state codec", () => {
  it("round-trips current V2 accounts and tombstones, and reads empty V1/V2", async () => {
    const current = await serializePersistedAccountState([record()], [revocation("account-deleted")], SECRET);
    const decoded = await deserializePersistedAccountState(current, SECRET);
    expect(decoded.kind).toBe("ready");
    if (decoded.kind !== "ready") throw new Error("expected ready state");
    expect(decoded.state.accounts.get("account-alpha")).toEqual(record());
    expect(decoded.state.revocations.get("account-deleted")).toEqual(revocation("account-deleted"));

    const v1 = await encryptedPayload({ version: 1, accounts: [record()] }, 1);
    const v1Decoded = await deserializePersistedAccountState(v1, SECRET);
    expect(v1Decoded.kind).toBe("ready");
    if (v1Decoded.kind !== "ready") throw new Error("expected ready state");
    expect(v1Decoded.state.migratedFromVersion).toBe(1);
    expect(v1Decoded.state.revocations.size).toBe(0);

    for (const version of [1, 2] as const) {
      const emptyPayload = version === 1 ? { version, accounts: [] } : { version, accounts: [], revocations: [] };
      const empty = await deserializePersistedAccountState(await encryptedPayload(emptyPayload, version), SECRET);
      expect(empty.kind).toBe("ready");
      if (empty.kind !== "ready") throw new Error("expected ready state");
      expect(empty.state.accounts.size).toBe(0);
      expect(empty.state.revocations.size).toBe(0);
    }
  });

  it("invalidates the whole snapshot when any nested record is malformed", async () => {
    const malformedAccount = { ...record(), account: { ...account(), id: "" } };
    const malformedOwner = { ...record(), ownerBrowserSecret: "" };
    const malformedRevocation = { ...revocation(), ownerBrowserSecret: "" };
    const payload = {
      version: 2,
      accounts: [record("valid-account"), malformedAccount, malformedOwner],
      revocations: [revocation("valid-account"), malformedRevocation]
    };

    const decoded = await deserializePersistedAccountState(await encryptedPayload(payload), SECRET);
    expect(decoded).toEqual({ kind: "invalid", reason: "payload" });
  });

  it("rejects credential mismatches, unknown fields, and live/tombstone collisions", async () => {
    const mismatchedCredentials = record("credential-mismatch", {
      credentials: { baseUrl: "https://other.example.com", username: "other-user", appPassword: "other-password" }
    });
    const payload = {
      version: 2,
      accounts: [{ ...mismatchedCredentials, unexpected: "accepted" }, record("collision")],
      revocations: [{ ...revocation("collision"), unexpected: true }],
      unexpected: "accepted"
    };
    const decoded = await deserializePersistedAccountState(await encryptedPayload(payload), SECRET);
    expect(decoded.kind).toBe("invalid");
  });

  it("rejects negative revocation revisions", async () => {
    const decoded = await deserializePersistedAccountState(await encryptedPayload({
      version: 2,
      accounts: [],
      revocations: [{ ...revocation("negative-revision"), revision: -1 }]
    }), SECRET);
    expect(decoded).toEqual({ kind: "invalid", reason: "payload" });
  });

  it("rejects duplicate accounts and duplicate tombstones", async () => {
    const firstAccount = record("duplicate");
    const secondAccount = { ...record("duplicate"), accountNonce: "second-nonce" };
    const firstRevocation = revocation("duplicate-revocation");
    const secondRevocation = { ...firstRevocation, revision: 2 };
    const decoded = await deserializePersistedAccountState(await encryptedPayload({
      version: 2,
      accounts: [firstAccount, secondAccount],
      revocations: [firstRevocation, secondRevocation]
    }), SECRET);
    expect(decoded).toEqual({ kind: "invalid", reason: "invariant" });
  });

  it("rejects invalid serializer input before encryption", async () => {
    const invalid = { ...record("invalid"), account: { ...account("invalid"), id: "" } };
    await expect(serializePersistedAccountState([invalid], [], SECRET)).rejects.toThrow("Persisted account state is invalid.");
  });

  it("distinguishes absent local state from malformed JSON and corrupt encrypted state", async () => {
    const directory = await mkdtemp(join(workerArtifactDirectory, "local-state-"));
    const missing = new LocalAccountStateStorage(join(directory, "missing.json"));
    await expect(missing.read()).resolves.toEqual({ revision: 0 });

    const malformedPath = join(directory, "malformed.json");
    await writeFile(malformedPath, "{not-json", "utf8");
    await expect(new LocalAccountStateStorage(malformedPath).read()).rejects.toThrow("Local account storage envelope is invalid.");

    const corruptPath = join(directory, "corrupt.json");
    await writeFile(corruptPath, JSON.stringify({ version: 2, algorithm: "AES-GCM", iv: "AQIDBA", ciphertext: "AQIDBA" }), "utf8");
    await expect(new LocalAccountStateStorage(corruptPath).read()).rejects.toThrow("Local account storage envelope is invalid.");
  });

  it("fails closed on a cold restart with corrupt local state", async () => {
    const directory = await mkdtemp(join(workerArtifactDirectory, "cold-state-"));
    const statePath = join(directory, "state.json");
    await writeFile(statePath, JSON.stringify({ version: 2, algorithm: "AES-GCM", iv: "AQID", ciphertext: "BAUG" }), "utf8");
    const repository = createAccountRepository({
      storage: new LocalAccountStateStorage(statePath),
      primarySecret: SECRET
    });
    await expect(repository.snapshot()).rejects.toBeInstanceOf(AccountRepositoryError);
    expect(await readFile(statePath, "utf8")).toContain('"version":2');
  });

  it("rejects malformed envelopes and wrong secrets without exposing error details", async () => {
    const valid = await encryptedPayload({ version: 2, accounts: [], revocations: [] });
    const cases: unknown[] = [
      undefined,
      {},
      { ...valid, version: 3 },
      { ...valid, algorithm: "AES-CBC" },
      { ...valid, iv: "%%%" },
      { ...valid, ciphertext: "%%%" },
      { ...valid, iv: toBase64Url(Uint8Array.from({ length: 8 }, (_, index) => index + 1)) },
      { ...valid, ciphertext: valid.ciphertext.slice(0, -1) + (valid.ciphertext.endsWith("A") ? "B" : "A") }
    ];
    for (const candidate of cases) {
      const decoded = await deserializePersistedAccountState(candidate, SECRET);
      expect(decoded.kind).toBe("invalid");
    }
    const wrongSecret = await deserializePersistedAccountState(valid, "different-secret");
    expect(wrongSecret).toEqual({ kind: "invalid", reason: "decrypt" });
  });

  it("distinguishes missing durable data from corrupt stored data", async () => {
    const storage = new Map<string, unknown>();
    const object = new AccountStoreDurableObject({
      storage: {
        get: async (key) => storage.get(key),
        put: async (key, value) => { storage.set(key, value); }
      }
    });

    const missing = await object.fetch(new Request("https://davora.internal/accounts"));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ stored: false, revision: 0 });

    storage.set("accounts", { version: 2, algorithm: "AES-GCM", iv: "%%%", ciphertext: "%%%" });
    const malformedEnvelope = await object.fetch(new Request("https://davora.internal/accounts"));
    expect(malformedEnvelope.status).toBe(500);

    storage.set("accounts", { version: 9 });
    const malformedOuter = await object.fetch(new Request("https://davora.internal/accounts"));
    expect(malformedOuter.status).toBe(500);
  });

  it("rejects malformed durable PUT bodies without replacing the prior value", async () => {
    const previous = { version: 2, algorithm: "AES-GCM", iv: "AQID", ciphertext: "BAUG" };
    const storage = new Map<string, unknown>([["accounts", previous]]);
    const object = new AccountStoreDurableObject({
      storage: {
        get: async (key) => storage.get(key),
        put: async (key, value) => { storage.set(key, value); }
      }
    });
    const response = await object.fetch(new Request("https://davora.internal/accounts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypted: { version: 2, algorithm: "AES-CBC", iv: "bad", ciphertext: "bad" } })
    }));
    expect(response.status).toBe(400);
    expect(storage.get("accounts")).toEqual(previous);
    expect((await object.fetch(new Request("https://davora.internal/accounts"))).status).toBe(500);
  });

  it("never includes persisted plaintext in the serialized envelope", async () => {
    const encrypted = await serializePersistedAccountState([record()], [], SECRET);
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain("app-password");
    expect(serialized).not.toContain("browser-secret");
    expect(serialized).not.toContain("demo-user");
    expect(serialized).not.toContain("mock-account.example.com");
  });
});
