import { describe, expect, it } from "vitest";

import { signSessionToken, verifySessionToken } from "../src/security/token";

describe("session token", () => {
  it("signs and verifies payloads", async () => {
    const token = await signSessionToken(
      {
        scope: "davora",
        accountId: "account-alpha",
        backend: "mock",
        rootPath: ".davora-agent-test",
        accountNonce: "nonce-alpha",
        exp: Math.floor(Date.now() / 1000) + 60
      },
      "secret"
    );

    await expect(verifySessionToken(token, "secret")).resolves.toMatchObject({
      scope: "davora",
      backend: "mock",
      accountId: "account-alpha"
    });
  });

  it("rejects expired tokens", async () => {
    const token = await signSessionToken(
      {
        scope: "davora",
        accountId: "account-alpha",
        backend: "mock",
        rootPath: ".davora-agent-test",
        accountNonce: "nonce-alpha",
        exp: Math.floor(Date.now() / 1000) - 1
      },
      "secret"
    );

    await expect(verifySessionToken(token, "secret")).rejects.toThrow(/expired/i);
  });
});
