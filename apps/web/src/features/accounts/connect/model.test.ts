import { describe, expect, it } from "vitest";

import { createEmptyAccountForm } from "./model";
import {
  CONNECT_FAILURE_ERROR,
  MISSING_CONNECT_FIELDS_ERROR,
  buildConnectSuccessStatus,
  shouldEnsureSessionAfterConnect,
  validateConnectForm
} from "./model";

describe("connect account model", () => {
  it("rejects missing connect fields", () => {
    expect(validateConnectForm(createEmptyAccountForm("add"))).toEqual({
      kind: "invalid",
      message: MISSING_CONNECT_FIELDS_ERROR
    });
  });

  it("builds a connect request with optional root path and label", () => {
    expect(validateConnectForm({
      ...createEmptyAccountForm("add"),
      baseUrl: " https://cloud.example.com ",
      username: " alice ",
      appPassword: "secret",
      rootPath: " .davora-agent-test ",
      label: " Personal "
    })).toEqual({
      kind: "valid",
      request: {
        type: "nextcloud",
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret",
        rootPath: ".davora-agent-test",
        label: "Personal"
      }
    });
  });

  it("omits empty root path and label from the connect request", () => {
    expect(validateConnectForm({
      ...createEmptyAccountForm("add"),
      baseUrl: "https://cloud.example.com",
      username: "alice",
      appPassword: "secret"
    })).toEqual({
      kind: "valid",
      request: {
        type: "nextcloud",
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      }
    });
  });

  it("preserves reconnect identifiers on reconnect forms", () => {
    expect(validateConnectForm({
      ...createEmptyAccountForm("reconnect"),
      accountId: "alpha",
      cacheNamespace: "ns-alpha",
      baseUrl: "https://cloud.example.com",
      username: "alice",
      appPassword: "secret"
    })).toEqual({
      kind: "valid",
      request: {
        type: "nextcloud",
        accountId: "alpha",
        cacheNamespace: "ns-alpha",
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      }
    });
  });

  it("skips ensure-session only when unlock is required", () => {
    expect(shouldEnsureSessionAfterConnect(false)).toBe(true);
    expect(shouldEnsureSessionAfterConnect(true)).toBe(false);
  });

  it("builds connect status and failure messages without echoing secrets", () => {
    expect(buildConnectSuccessStatus("Personal cloud")).toBe("Connected account Personal cloud");
    expect(CONNECT_FAILURE_ERROR).toBe("Unable to connect account.");
    expect(CONNECT_FAILURE_ERROR).not.toContain("secret");
  });
});
