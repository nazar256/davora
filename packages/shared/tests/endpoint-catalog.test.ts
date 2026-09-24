import { describe, expect, it } from "vitest";

import {
  apiEndpoints,
  connectAccountEndpoint,
  deleteAccountEndpoint,
  sessionEndpoint
} from "../src";

describe("API endpoint catalog", () => {
  it("contains every public Worker endpoint exactly once", () => {
    expect(Object.keys(apiEndpoints)).toHaveLength(18);
    expect(new Set(Object.values(apiEndpoints).map((endpoint) => endpoint.id)).size).toBe(18);
    expect(apiEndpoints.connectAccount).toBe(connectAccountEndpoint);
    expect(apiEndpoints.deleteAccount).toBe(deleteAccountEndpoint);
    expect(apiEndpoints.session).toBe(sessionEndpoint);
  });

  it("keeps browser-owned account endpoints out of the session-authenticated file surface", () => {
    expect(apiEndpoints.connectAccount.auth).toBe("browser");
    expect(apiEndpoints.deleteAccount.auth).toBe("browser");
    expect(apiEndpoints.session.auth).toBe("browser");
  });
});
