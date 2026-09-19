import { capabilitySetSchema, connectedAccountSchema, finiteDateTimeSchema, safeHttpBaseUrlSchema, type AppSession } from "@davora/shared";

import { EMPTY_ACCOUNT_REGISTRY, type AccountRegistrySnapshot, type StoredAccountRecord } from "./model";

export type RegistryRepair =
  | { readonly kind: "none" }
  | { readonly kind: "write"; readonly value: string }
  | { readonly kind: "delete" };

export type DecodedAccountRegistry = {
  readonly kind: "ready" | "repaired";
  readonly snapshot: AccountRegistrySnapshot;
  readonly repair: RegistryRepair;
  readonly warning?: string;
};

const connectedAccountKeys = new Set([
  "id",
  "type",
  "label",
  "displayName",
  "baseUrl",
  "username",
  "rootPath",
  "backend",
  "connectionState",
  "lastValidatedAt",
  "cacheNamespace"
]);

export const encodeAccountRegistry = (snapshot: AccountRegistrySnapshot): string => JSON.stringify(snapshot);

export function decodeAccountRegistry(raw: string | null, isExpired: (expiresAt: string) => boolean = () => false): DecodedAccountRegistry {
  if (raw === null) {
    return { kind: "ready", snapshot: EMPTY_ACCOUNT_REGISTRY, repair: { kind: "none" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return corruptRoot();
  }
  if (!isRegistryRoot(parsed)) {
    return corruptRoot();
  }

  const root = parsed;
  const accounts: StoredAccountRecord[] = [];
  const ids = new Set<string>();
  const namespaces = new Set<string>();
  for (const candidate of root.accounts) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const rawRecord = candidate as { account?: unknown; session?: unknown; pendingRemoval?: unknown; pendingReconnect?: unknown };
    const accountResult = connectedAccountSchema.safeParse(stripUnknownAccountFields(rawRecord.account));
    if (!accountResult.success || ids.has(accountResult.data.id) || namespaces.has(accountResult.data.cacheNamespace)) {
      continue;
    }
    ids.add(accountResult.data.id);
    namespaces.add(accountResult.data.cacheNamespace);
    const record: StoredAccountRecord = { account: accountResult.data };
    if (rawRecord.session !== undefined) {
      const session = parseStoredSession(rawRecord.session);
      if (session
        && session.rootPath === accountResult.data.rootPath
        && session.capabilities.backend === accountResult.data.backend
        && !isExpired(session.expiresAt)) {
        Object.assign(record, { session });
      }
    }
    if (rawRecord.pendingRemoval !== undefined) {
      const pendingRemoval = parsePendingRemoval(rawRecord.pendingRemoval);
      if (pendingRemoval) {
        Object.assign(record, { pendingRemoval });
      }
    }
    if (rawRecord.pendingReconnect !== undefined) {
      const pendingReconnect = parsePendingReconnect(rawRecord.pendingReconnect);
      if (pendingReconnect) {
        Object.assign(record, { pendingReconnect });
      }
    }
    accounts.push(record);
  }

  const requestedActiveId = typeof root.activeAccountId === "string" ? root.activeAccountId : undefined;
  const activeAccountId = requestedActiveId && ids.has(requestedActiveId) ? requestedActiveId : accounts[0]?.account.id;
  const snapshot: AccountRegistrySnapshot = {
    ...(activeAccountId ? { activeAccountId } : {}),
    accounts
  };
  const canonical = encodeAccountRegistry(snapshot);
  if (stableJson(parsed) === stableJson(snapshot)) {
    return { kind: "ready", snapshot, repair: { kind: "none" } };
  }
  return { kind: "repaired", snapshot, repair: { kind: "write", value: canonical } };
}

function stripUnknownAccountFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => connectedAccountKeys.has(key)));
}

function parsePendingRemoval(value: unknown): StoredAccountRecord["pendingRemoval"] {
  if (!value || typeof value !== "object") return undefined;
  const phase = (value as { phase?: unknown }).phase;
  return phase === "revoke" || phase === "purge" ? { phase } : undefined;
}

function isRegistryRoot(value: unknown): value is { readonly activeAccountId?: unknown; readonly accounts: unknown[] } {
  return Boolean(value && typeof value === "object" && "accounts" in value && Array.isArray(value.accounts));
}

function parseStoredSession(value: unknown): StoredAccountRecord["session"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<AppSession>;
  const capabilities = capabilitySetSchema.safeParse(candidate.capabilities);
  const expiresAt = finiteDateTimeSchema.safeParse(candidate.expiresAt);
  if (typeof candidate.token !== "string" || candidate.token.length === 0
    || !expiresAt.success
    || typeof candidate.rootPath !== "string" || !capabilities.success) {
    return undefined;
  }
  return {
    token: candidate.token,
    expiresAt: expiresAt.data,
    rootPath: candidate.rootPath,
    capabilities: capabilities.data
  };
}

function parsePendingReconnect(value: unknown): StoredAccountRecord["pendingReconnect"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { baseUrl?: unknown; username?: unknown; label?: unknown };
  const baseUrl = safeHttpBaseUrlSchema.safeParse(candidate.baseUrl);
  if (!baseUrl.success || typeof candidate.username !== "string"
    || (candidate.label !== undefined && typeof candidate.label !== "string")) {
    return undefined;
  }
  return {
    baseUrl: baseUrl.data,
    username: candidate.username,
    ...(typeof candidate.label === "string" ? { label: candidate.label } : {})
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function corruptRoot(): DecodedAccountRegistry {
  return {
    kind: "repaired",
    snapshot: EMPTY_ACCOUNT_REGISTRY,
    repair: { kind: "delete" },
    warning: "Saved account data was invalid and has been reset."
  };
}
