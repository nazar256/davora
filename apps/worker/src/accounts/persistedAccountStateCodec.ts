import {
  connectedAccountSchema,
  safeHttpBaseUrlSchema,
  type ConnectedAccount
} from "@davora/shared";

export interface NextcloudAccountCredentials {
  baseUrl: string;
  username: string;
  appPassword: string;
}

export interface PersistedAccountRecord {
  account: ConnectedAccount;
  accountNonce: string;
  ownerBrowserId: string;
  ownerBrowserSecret: string;
  credentials?: NextcloudAccountCredentials;
}

export interface PersistedAccountRevocation {
  accountId: string;
  ownerBrowserId: string;
  ownerBrowserSecret: string;
  revocationNonce: string;
  revision: number;
}

export interface PersistedAccountStateV1 {
  version: 1;
  accounts: PersistedAccountRecord[];
}

export interface PersistedAccountStateV2 {
  version: 2;
  accounts: PersistedAccountRecord[];
  revocations: PersistedAccountRevocation[];
}

export interface EncryptedAccountState {
  version: 1 | 2;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

export type PersistedAccountState = {
  readonly accounts: ReadonlyMap<string, PersistedAccountRecord>;
  readonly revocations: ReadonlyMap<string, PersistedAccountRevocation>;
  readonly migratedFromVersion?: 1;
};

export type PersistedAccountDecodeFailure = "envelope" | "decrypt" | "payload" | "invariant";

export type PersistedAccountDecodeResult =
  | { readonly kind: "ready"; readonly state: PersistedAccountState }
  | { readonly kind: "invalid"; readonly reason: PersistedAccountDecodeFailure };

export type PersistedAccountReadResult =
  | { readonly kind: "absent" }
  | PersistedAccountDecodeResult;

const accountKeys = ["id", "type", "label", "displayName", "baseUrl", "username", "rootPath", "backend", "connectionState", "lastValidatedAt", "cacheNamespace"] as const;
const recordKeys = ["account", "accountNonce", "ownerBrowserId", "ownerBrowserSecret", "credentials"] as const;
const credentialsKeys = ["baseUrl", "username", "appPassword"] as const;
const revocationKeys = ["accountId", "ownerBrowserId", "ownerBrowserSecret", "revocationNonce", "revision"] as const;

function parsePersistedAccountRecord(value: unknown): PersistedAccountRecord | undefined {
  if (!isRecord(value) || !(hasExactKeys(value, recordKeys) || hasExactKeys(value, recordKeys.filter((key) => key !== "credentials"))) || typeof value.accountNonce !== "string" || !value.accountNonce
    || typeof value.ownerBrowserId !== "string" || !value.ownerBrowserId
    || typeof value.ownerBrowserSecret !== "string" || !value.ownerBrowserSecret) return undefined;
  if (!isRecord(value.account)
    || !(hasExactKeys(value.account, accountKeys) || hasExactKeys(value.account, accountKeys.filter((key) => key !== "label")))) return undefined;
  const accountResult = connectedAccountSchema.safeParse(value.account);
  if (!accountResult.success) return undefined;
  let credentials: NextcloudAccountCredentials | undefined;
  if (value.credentials !== undefined) {
    const candidate = value.credentials;
    if (!isRecord(candidate) || !hasExactKeys(candidate, credentialsKeys)) return undefined;
    const baseUrl = candidate.baseUrl;
    const username = candidate.username;
    const appPassword = candidate.appPassword;
    if (typeof baseUrl !== "string" || !safeHttpBaseUrlSchema.safeParse(baseUrl).success
      || typeof username !== "string" || !username
      || typeof appPassword !== "string" || !appPassword) return undefined;
    credentials = { baseUrl, username, appPassword };
  }
  return {
    account: accountResult.data,
    accountNonce: value.accountNonce,
    ownerBrowserId: value.ownerBrowserId,
    ownerBrowserSecret: value.ownerBrowserSecret,
    ...(credentials ? { credentials } : {})
  };
}

function parsePersistedAccountRevocation(value: unknown): PersistedAccountRevocation | undefined {
  if (!isRecord(value) || !hasExactKeys(value, revocationKeys)
    || typeof value.accountId !== "string" || !value.accountId
    || typeof value.ownerBrowserId !== "string" || !value.ownerBrowserId
    || typeof value.ownerBrowserSecret !== "string" || !value.ownerBrowserSecret
    || typeof value.revocationNonce !== "string" || !value.revocationNonce
    || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) return undefined;
  return {
    accountId: value.accountId,
    ownerBrowserId: value.ownerBrowserId,
    ownerBrowserSecret: value.ownerBrowserSecret,
    revocationNonce: value.revocationNonce,
    revision: value.revision
  };
}

function invalid(reason: PersistedAccountDecodeFailure): PersistedAccountDecodeResult {
  return { kind: "invalid", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function validateRecordInvariants(
  accounts: PersistedAccountRecord[],
  revocations: PersistedAccountRevocation[]
): PersistedAccountDecodeResult | undefined {
  const accountIds = new Set<string>();
  for (const record of accounts) {
    const accountId = record.account.id;
    if (accountIds.has(accountId)) return invalid("invariant");
    accountIds.add(accountId);
    if (record.account.backend === "nextcloud" && !record.credentials) return invalid("invariant");
    if (record.credentials && (
      record.credentials.baseUrl !== record.account.baseUrl
      || record.credentials.username !== record.account.username
    )) return invalid("invariant");
  }

  const revocationIds = new Set<string>();
  for (const revocation of revocations) {
    if (revocationIds.has(revocation.accountId) || accountIds.has(revocation.accountId)) return invalid("invariant");
    revocationIds.add(revocation.accountId);
  }
  return undefined;
}

function readyState(
  accounts: PersistedAccountRecord[],
  revocations: PersistedAccountRevocation[],
  migratedFromVersion?: 1
): PersistedAccountDecodeResult {
  const invariantFailure = validateRecordInvariants(accounts, revocations);
  if (invariantFailure) return invariantFailure;
  return {
    kind: "ready",
    state: {
      accounts: new Map(accounts.map((record) => [record.account.id, record])),
      revocations: new Map(revocations.map((revocation) => [revocation.accountId, revocation])),
      ...(migratedFromVersion ? { migratedFromVersion } : {})
    }
  };
}

export function parsePersistedAccountPayload(value: unknown): PersistedAccountDecodeResult {
  if (!isRecord(value) || typeof value.version !== "number") return invalid("payload");
  if (value.version === 1) {
    if (!hasExactKeys(value, ["version", "accounts"]) || !Array.isArray(value.accounts)) return invalid("payload");
    const parsedAccounts: PersistedAccountRecord[] = [];
    for (const candidate of value.accounts) {
      const parsed = parsePersistedAccountRecord(candidate);
      if (!parsed) return invalid("payload");
      parsedAccounts.push(parsed);
    }
    return readyState(parsedAccounts, [], 1);
  }
  if (value.version !== 2) return invalid("payload");
  if (!hasExactKeys(value, ["version", "accounts", "revocations"])
    || !Array.isArray(value.accounts)
    || !Array.isArray(value.revocations)) return invalid("payload");

  const parsedAccounts: PersistedAccountRecord[] = [];
  for (const candidate of value.accounts) {
    const parsed = parsePersistedAccountRecord(candidate);
    if (!parsed) return invalid("payload");
    parsedAccounts.push(parsed);
  }
  const parsedRevocations: PersistedAccountRevocation[] = [];
  for (const candidate of value.revocations) {
    const parsed = parsePersistedAccountRevocation(candidate);
    if (!parsed) return invalid("payload");
    parsedRevocations.push(parsed);
  }
  return readyState(parsedAccounts, parsedRevocations);
}

export function buildPersistedAccountPayload(
  accounts: Iterable<PersistedAccountRecord>,
  revocations: Iterable<PersistedAccountRevocation>
): PersistedAccountStateV2 {
  const payload: PersistedAccountStateV2 = {
    version: 2,
    accounts: Array.from(accounts),
    revocations: Array.from(revocations)
  };
  const parsed = parsePersistedAccountPayload(payload);
  if (parsed.kind !== "ready") throw new Error("Persisted account state is invalid.");
  return payload;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const canonical = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return canonical === value ? bytes : undefined;
  } catch {
    return undefined;
  }
}

export function parseEncryptedAccountState(value: unknown): EncryptedAccountState | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "algorithm", "iv", "ciphertext"])) return undefined;
  if ((value.version !== 1 && value.version !== 2) || value.algorithm !== "AES-GCM"
    || typeof value.iv !== "string" || typeof value.ciphertext !== "string") return undefined;
  const iv = decodeBase64Url(value.iv);
  const ciphertext = decodeBase64Url(value.ciphertext);
  if (!iv || iv.byteLength !== 12 || !ciphertext || ciphertext.byteLength < 16) return undefined;
  return { version: value.version, algorithm: "AES-GCM", iv: value.iv, ciphertext: value.ciphertext };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function serializePersistedAccountState(
  accounts: Iterable<PersistedAccountRecord>,
  revocations: Iterable<PersistedAccountRevocation>,
  secret: string
): Promise<EncryptedAccountState> {
  const key = await importEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(buildPersistedAccountPayload(accounts, revocations)));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return {
    version: 2,
    algorithm: "AES-GCM",
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext))
  };
}

export async function deserializePersistedAccountState(
  encrypted: unknown,
  secret: string
): Promise<PersistedAccountDecodeResult> {
  const parsedEnvelope = parseEncryptedAccountState(encrypted);
  if (!parsedEnvelope) return invalid("envelope");
  const iv = decodeBase64Url(parsedEnvelope.iv);
  const ciphertext = decodeBase64Url(parsedEnvelope.ciphertext);
  if (!iv || !ciphertext) return invalid("envelope");

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      await importEncryptionKey(secret),
      toArrayBuffer(ciphertext)
    );
  } catch {
    return invalid("decrypt");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return invalid("payload");
  }
  const result = parsePersistedAccountPayload(payload);
  if (result.kind === "ready") {
    const payloadVersion = result.state.migratedFromVersion ?? 2;
    if (payloadVersion !== parsedEnvelope.version) return invalid("invariant");
  }
  return result;
}
