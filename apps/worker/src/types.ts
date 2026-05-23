import type { CapabilitySet, ConnectedAccount } from "@davora/shared";

export interface WorkerEnv {
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: number;
  ALLOWED_ORIGINS: string[];
  APP_UNLOCK_CODE?: string;
  NEXTCLOUD_ROOT_PATH: string;
  NEXTCLOUD_ALLOWED_HOSTS: string[];
  NEXTCLOUD_MAX_FILE_BYTES: number;
  NEXTCLOUD_MAX_TEXT_FILE_BYTES: number;
  MOCK_BACKEND: boolean;
  LOCAL_DEV_STATE_PATH?: string;
}

export interface SessionPayload {
  scope: "davora";
  accountId: string;
  backend: "mock" | "nextcloud";
  rootPath: string;
  accountNonce: string;
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
