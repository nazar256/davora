import { describe, expect, it } from "vitest";

import { connectAccountEndpoint, deleteAccountEndpoint, sessionEndpoint } from "../src/api";

describe("account and session endpoint contracts", () => {
  it("strips legacy unknown request fields without weakening success envelopes", () => {
    const connect = connectAccountEndpoint.requestSchema.parse({
      type: "nextcloud",
      baseUrl: "https://cloud.example.com",
      username: "alice",
      appPassword: "sentinel",
      LOCAL_DEV_STATE_PATH: ".tmp/ignored"
    });
    expect(connect).not.toHaveProperty("LOCAL_DEV_STATE_PATH");
    expect(connectAccountEndpoint.successSchema.safeParse({ data: { account: {} } }).success).toBe(false);

    const session = sessionEndpoint.requestSchema.parse({ accountId: "alpha", ignored: true });
    expect(session).toEqual({ accountId: "alpha" });
  });

  it("builds and strictly parses encoded dynamic account paths", () => {
    const path = deleteAccountEndpoint.buildPath("account/with spaces");
    expect(path).toBe("/api/accounts/account%2Fwith%20spaces");
    expect(deleteAccountEndpoint.parsePath(path)).toBe("account/with spaces");
    expect(deleteAccountEndpoint.parsePath("/api/accounts/%" )).toBeUndefined();
    expect(deleteAccountEndpoint.parsePath("/api/accounts/alpha/extra")).toBeUndefined();
  });
});
