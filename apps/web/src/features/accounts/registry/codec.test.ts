import { describe, expect, it } from "vitest";

import { buildAccount, buildSession } from "../../../test/accounts";
import { decodeAccountRegistry, encodeAccountRegistry } from "./codec";

const NOW = Date.parse("2026-07-23T12:00:00.000Z");

describe("account registry codec", () => {
  it("treats missing storage as ready-empty without repair", () => {
    expect(decodeAccountRegistry(null, (value) => Date.parse(value) <= NOW)).toEqual({
      kind: "ready",
      snapshot: { accounts: [] },
      repair: { kind: "none" }
    });
  });

  it("sanitizes malformed records, expired sessions, duplicates, active identity, and unknown fields", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta", { cacheNamespace: "ns-alpha" });
    const expired = buildSession(alpha, { expiresAt: "2026-07-22T00:00:00.000Z" });
    const raw = JSON.stringify({
      activeAccountId: "missing",
      browserSecret: "browser-secret-sentinel",
      accounts: [
        { account: { ...alpha, appPassword: "password-sentinel" }, session: expired, token: "token-sentinel" },
        { account: beta },
        { account: { displayName: "broken" } }
      ]
    });

    const decoded = decodeAccountRegistry(raw, (value) => Date.parse(value) <= NOW);

    expect(decoded.kind).toBe("repaired");
    expect(decoded.snapshot).toEqual({ activeAccountId: "alpha", accounts: [{ account: alpha }] });
    expect(JSON.stringify(decoded.snapshot)).not.toMatch(/password-sentinel|token-sentinel|browser-secret-sentinel/);
    expect(decoded.repair.kind).toBe("write");
  });

  it("turns a corrupt root into a deferred delete repair and stable warning", () => {
    expect(decodeAccountRegistry("not-json", (value) => Date.parse(value) <= NOW)).toEqual({
      kind: "repaired",
      snapshot: { accounts: [] },
      repair: { kind: "delete" },
      warning: "Saved account data was invalid and has been reset."
    });
  });

  it("round-trips only canonical account registry fields", () => {
    const alpha = buildAccount("alpha");
    const encoded = encodeAccountRegistry({ activeAccountId: alpha.id, accounts: [{ account: alpha }] });
    expect(decodeAccountRegistry(encoded, (value) => Date.parse(value) <= NOW)).toMatchObject({ kind: "ready", repair: { kind: "none" } });
  });

  it("drops persisted sessions whose account-owned metadata is incoherent", () => {
    const alpha = buildAccount("alpha");
    const wrongRoot = buildSession(alpha, { rootPath: "other-root" });
    const wrongBackend = buildSession(alpha, { capabilities: { ...buildSession(alpha).capabilities, backend: "nextcloud" } });

    expect(decodeAccountRegistry(JSON.stringify({ accounts: [{ account: alpha, session: wrongRoot }] })).snapshot.accounts[0]?.session).toBeUndefined();
    expect(decodeAccountRegistry(JSON.stringify({ accounts: [{ account: alpha, session: wrongBackend }] })).snapshot.accounts[0]?.session).toBeUndefined();
  });
});
