import { describe, expect, it } from "vitest";

import {
  appSessionSchema,
  capabilitySetSchema,
  connectedAccountSchema
} from "../src/index";

const account = {
  id: "alpha",
  type: "nextcloud",
  displayName: "Alpha",
  baseUrl: "https://cloud.example.com",
  username: "alice",
  rootPath: ".davora-agent-test",
  backend: "mock",
  connectionState: "connected",
  lastValidatedAt: "2026-07-23T00:00:00.000Z",
  cacheNamespace: "ns-alpha"
} as const;

const capabilities = {
  backend: "mock",
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
} as const;

describe("account runtime contracts", () => {
  it("validates capabilities, connected accounts, and complete sessions", () => {
    expect(capabilitySetSchema.parse(capabilities)).toEqual(capabilities);
    expect(connectedAccountSchema.parse(account)).toEqual(account);
    expect(appSessionSchema.parse({
      token: "opaque-session-token",
      expiresAt: "2026-07-24T00:00:00.000Z",
      rootPath: account.rootPath,
      capabilities,
      account
    })).toMatchObject({ account, capabilities });
  });

  it("rejects invalid account and session identities", () => {
    expect(connectedAccountSchema.safeParse({ ...account, type: "webdav" }).success).toBe(false);
    expect(appSessionSchema.safeParse({ account, capabilities, token: "", expiresAt: "bad", rootPath: account.rootPath }).success).toBe(false);
  });

  it("rejects impossible calendar timestamps and unsafe account base URLs", () => {
    expect(connectedAccountSchema.safeParse({ ...account, lastValidatedAt: "2026-02-31T00:00:00.000Z" }).success).toBe(false);
    expect(appSessionSchema.safeParse({ account, capabilities, token: "token", expiresAt: "2026-02-31T00:00:00.000Z", rootPath: account.rootPath }).success).toBe(false);
    for (const baseUrl of [
      "relative/path",
      "ftp://cloud.example.com",
      "https://alice:secret@cloud.example.com",
      "https://cloud.example.com?token=secret",
      "https://cloud.example.com#fragment"
    ]) {
      expect(connectedAccountSchema.safeParse({ ...account, baseUrl }).success).toBe(false);
    }
    expect(connectedAccountSchema.safeParse({ ...account, baseUrl: "https://cloud.example.com/nextcloud/" }).success).toBe(true);
  });
});
