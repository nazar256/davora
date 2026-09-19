import { describe, expect, it } from "vitest";

import { signSessionToken, signStreamToken, TokenVerificationError, verifySessionToken, verifyStreamToken } from "../src/security/token";

describe("session token", () => {
  it("preserves the established serialized token bytes", async () => {
    await expect(signSessionToken({
      scope: "davora",
      accountId: "account-alpha",
      backend: "mock",
      rootPath: ".davora-agent-test",
      accountNonce: "nonce-alpha",
      exp: 2_000_000_000
    }, "secret")).resolves.toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImRhdm9yYSIsImFjY291bnRJZCI6ImFjY291bnQtYWxwaGEiLCJiYWNrZW5kIjoibW9jayIsInJvb3RQYXRoIjoiLmRhdm9yYS1hZ2VudC10ZXN0IiwiYWNjb3VudE5vbmNlIjoibm9uY2UtYWxwaGEiLCJleHAiOjIwMDAwMDAwMDB9.KNiP40tgos2LkiV7RtLcq8XHOHIprrgKBUrlJgaIFTg");
  });

  it("uses closed typed failures for token rejection outcomes", async () => {
    await expect(verifySessionToken("bad-token", "secret")).rejects.toMatchObject({ kind: "malformed" });
    const streamToken = await signStreamToken({
      scope: "davora-stream",
      accountId: "account-alpha",
      backend: "mock",
      rootPath: ".davora-agent-test",
      accountNonce: "nonce-alpha",
      path: "Projects/song.mp3",
      exp: 2_000_000_000
    }, "secret");
    await expect(verifySessionToken(streamToken, "secret")).rejects.toMatchObject({ kind: "invalid_session_scope" });
    await expect(verifyStreamToken(streamToken, "secret")).resolves.toMatchObject({ scope: "davora-stream" });
    expect(new TokenVerificationError("expired").message).toBe("Token expired.");
  });

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
