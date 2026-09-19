import { describe, expect, it } from "vitest";

import { searchEndpoint } from "../src/index";

describe("search endpoint contract", () => {
  it("preserves the raw query and backend result order", () => {
    const payload = {
      data: {
        path: "Docs",
        query: "  Report ",
        items: [
          { path: "Docs/z.txt", name: "z.txt", isFolder: false, score: 2 },
          { path: "Docs/a.txt", name: "a.txt", isFolder: false, score: 1 }
        ]
      }
    };

    expect(searchEndpoint.successSchema.parse(payload)).toEqual(payload);
    expect(searchEndpoint.requestSchema.parse({ path: "Docs", query: "  Report " }))
      .toEqual({ path: "Docs", query: "  Report " });
  });

  it.each([
    { data: { path: "Docs", query: "x", items: [{ path: "../x", name: "x", isFolder: false, score: 1 }] } },
    { data: { path: "Docs", query: "x", items: [{ path: "Docs/x", name: "x", isFolder: false, score: "high" }] } },
    { data: { path: "Docs", query: "x", items: [], extra: true } },
    { data: { path: "Docs", query: "x", items: [] }, extra: true }
  ])("rejects malformed search envelopes", (payload) => {
    expect(searchEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });
});
