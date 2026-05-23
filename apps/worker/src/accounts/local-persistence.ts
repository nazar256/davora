import type { ConnectedAccount } from "@davora/shared";

import type { NextcloudAccountCredentials } from "../types";

interface PersistedAccountRecord {
  account: ConnectedAccount;
  accountNonce: string;
  ownerBrowserId: string;
  ownerBrowserSecret: string;
  credentials?: NextcloudAccountCredentials;
}

interface PersistedAccountState {
  version: 1;
  accounts: PersistedAccountRecord[];
}

interface EncryptedPersistedAccountState {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

const CURRENT_VERSION = 1;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function normalizeStoragePath(storagePath: string): string {
  return storagePath;
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptState(state: PersistedAccountState, secret: string): Promise<EncryptedPersistedAccountState> {
  const key = await importEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return {
    version: CURRENT_VERSION,
    algorithm: "AES-GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

async function decryptState(payload: EncryptedPersistedAccountState, secret: string): Promise<PersistedAccountState> {
  const key = await importEncryptionKey(secret);
  const iv = fromBase64Url(payload.iv);
  const ciphertext = fromBase64Url(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as PersistedAccountState;
}

async function ensureParentDirectory(storagePath: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(storagePath), { recursive: true });
}

export async function readPersistedAccounts(storagePath: string, secret: string): Promise<Map<string, PersistedAccountRecord>> {
  const normalizedPath = normalizeStoragePath(storagePath);
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(normalizedPath, "utf8");
    let encrypted: Partial<EncryptedPersistedAccountState>;
    try {
      encrypted = JSON.parse(raw) as Partial<EncryptedPersistedAccountState>;
    } catch {
      return new Map();
    }

    if (encrypted.version !== CURRENT_VERSION || encrypted.algorithm !== "AES-GCM" || !encrypted.iv || !encrypted.ciphertext) {
      return new Map();
    }

    let parsed: PersistedAccountState;
    try {
      parsed = await decryptState(encrypted as EncryptedPersistedAccountState, secret);
    } catch {
      return new Map();
    }
    if (parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.accounts)) {
      return new Map();
    }

    const entries = parsed.accounts
      .filter((record): record is PersistedAccountRecord => {
        return Boolean(
          record?.account?.id
            && record.accountNonce
            && record.ownerBrowserId
            && record.ownerBrowserSecret
        );
      })
      .map((record) => [record.account.id, record] as const);

    return new Map(entries);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

export async function writePersistedAccounts(
  storagePath: string,
  accounts: Iterable<PersistedAccountRecord>,
  secret: string
): Promise<void> {
  const normalizedPath = normalizeStoragePath(storagePath);
  await ensureParentDirectory(normalizedPath);
  const { rename, writeFile } = await import("node:fs/promises");
  const payload: PersistedAccountState = {
    version: CURRENT_VERSION,
    accounts: Array.from(accounts)
  };
  const encryptedPayload = await encryptState(payload, secret);
  const tempPath = `${normalizedPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(encryptedPayload, null, 2), "utf8");
  await rename(tempPath, normalizedPath);
}

export type { PersistedAccountRecord };
