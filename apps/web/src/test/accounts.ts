import type { AppSession, ConnectedAccount } from "@davora/shared";

export const buildAccount = (
  id: string,
  overrides: Partial<ConnectedAccount> = {}
): ConnectedAccount => ({
  id,
  type: "nextcloud",
  displayName: `Account ${id}`,
  label: `Account ${id}`,
  baseUrl: `https://${id}.example.com`,
  username: `${id}-user`,
  rootPath: ".davora-agent-test",
  backend: "mock",
  connectionState: "connected",
  lastValidatedAt: "2026-05-21T10:00:00.000Z",
  cacheNamespace: `ns-${id}`,
  ...overrides
});

export const buildSession = (
  account: ConnectedAccount,
  overrides: Partial<AppSession> = {}
): AppSession => ({
  token: `token-${account.id}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  rootPath: account.rootPath,
  capabilities: {
    backend: account.backend,
    readOnly: false,
    search: true,
    preview: true,
    download: true,
    offlineCache: true,
    createFolder: true,
    upload: true,
    move: true,
    copy: true,
    delete: true,
    mediaPreview: true,
    markdownPreview: true,
    openedFileCache: true
  },
  account,
  ...overrides
});
