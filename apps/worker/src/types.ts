import type { CapabilitySet, ConnectedAccount } from "@davora/shared";
import type { AccountStateStorage } from "./accounts/storage";

export interface DiagnosticRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface DiagnosticR2Object {
  readonly key: string;
  readonly size: number;
  readonly customMetadata?: Record<string, string>;
}

export interface DiagnosticR2Bucket {
  head(key: string): Promise<DiagnosticR2Object | null>;
  delete(key: string): Promise<void>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null,
    options?: {
      onlyIf?: Headers | { etagDoesNotMatch?: string };
      customMetadata?: Record<string, string>;
      httpMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | string;
    }
  ): Promise<DiagnosticR2Object | null>;
}

export interface WorkerEnv {
  SESSION_SECRET: string;
  ACCOUNT_STATE_SECRET?: string;
  SESSION_TOKEN_SECRET?: string;
  SESSION_TTL_SECONDS: number;
  ALLOWED_ORIGINS: string[];
  APP_UNLOCK_CODE?: string;
  NEXTCLOUD_ROOT_PATH: string;
  NEXTCLOUD_ALLOWED_HOSTS: string[];
  RUNTIME_MODE: "production" | "development";
  ALLOW_LOCAL_NEXTCLOUD: boolean;
  NEXTCLOUD_MAX_FILE_BYTES: number;
  NEXTCLOUD_MAX_TEXT_FILE_BYTES: number;
  MOCK_BACKEND: boolean;
  LOCAL_DEV_STATE_PATH?: string;
  DAVORA_ACCOUNT_STORE?: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  };
  ACCOUNT_STATE_STORAGE?: AccountStateStorage;
  DIAGNOSTIC_UPLOAD_ENABLED?: boolean;
  DIAGNOSTIC_QUOTA_SECRET?: string;
  WORKER_BUILD_LABEL?: string;
  DAVORA_DIAGNOSTIC_REPORTS?: DiagnosticR2Bucket;
  DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER?: DiagnosticRateLimiter;
  DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER?: DiagnosticRateLimiter;
}

export interface SessionPayload {
  scope: "davora";
  accountId: string;
  backend: "mock" | "nextcloud";
  rootPath: string;
  accountNonce: string;
  exp: number;
}

export interface StreamTokenPayload {
  scope: "davora-stream";
  accountId: string;
  backend: "mock" | "nextcloud";
  rootPath: string;
  accountNonce: string;
  path: string;
  exp: number;
}

export interface NextcloudAccountCredentials {
  baseUrl: string;
  username: string;
  appPassword: string;
}

export interface AuthorizedAccountContext {
  account: ConnectedAccount;
  accountNonce: string;
  credentials?: NextcloudAccountCredentials;
  capabilities: CapabilitySet;
}

export interface DavMultistatusItem {
  href: string;
  isFolder: boolean;
  displayName?: string;
  size?: number;
  contentType?: string;
  lastModified?: string;
  etag?: string;
  permissions?: string;
  ownerDisplayName?: string;
}
