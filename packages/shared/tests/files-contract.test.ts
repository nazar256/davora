import { describe, expect, it } from "vitest";

import { filesEndpoint } from "../src/index";

describe("files endpoint contract", () => {
  it("accepts the strict folder response envelope", () => {
    expect(filesEndpoint.successSchema.parse({
      data: {
        path: "Docs",
        items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false, size: 1, permissions: "RGDNVCK", ownerDisplayName: "Owner" }]
      }
    })).toEqual({
      data: {
        path: "Docs",
        items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false, size: 1, permissions: "RGDNVCK", ownerDisplayName: "Owner" }]
      }
    });
  });

  it.each([
    { data: { path: "Docs", items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: "no" }] } },
    { data: { path: "Docs", items: [], unexpected: true } },
    { path: "Docs", items: [] }
  ])("rejects malformed Worker envelopes", (payload) => {
    expect(filesEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });
});
