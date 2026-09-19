import { beforeEach, describe, expect, it } from "vitest";

import { authorizedRequest, createSessionToken, resetConnectedAccountStoreForTests } from "./support/workerApplicationHarness";

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});
describe("worker app multi-account foundation", () => {
  it("connects an account, creates a bound session, and lists files in mock mode", async () => {
    const { token } = await createSessionToken();
    const response = await authorizedRequest(token, "/api/files?path=Projects");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { items: Array<{ path: string }> } };
    expect(payload.data.items.map((item) => item.path)).toContain("Projects/roadmap.txt");
  })
});
