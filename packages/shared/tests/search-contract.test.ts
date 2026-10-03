import { describe, expect, it } from "vitest";

import { searchEndpoint } from "../src/index";

describe("search endpoint contract", () => {
  it("preserves the raw query and backend result order", () => {
    const payload = {
      data: {
        completeness: "complete",
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
    { data: { completeness: "complete", path: "Docs", query: "x", items: [{ path: "../x", name: "x", isFolder: false, score: 1 }] } },
    { data: { completeness: "complete", path: "Docs", query: "x", items: [{ path: "Docs/x", name: "x", isFolder: false, score: "high" }] } },
    { data: { completeness: "complete", path: "Docs", query: "x", items: [], extra: true } },
    { data: { completeness: "complete", path: "Docs", query: "x", items: [] }, extra: true }
  ])("rejects malformed search envelopes", (payload) => {
    expect(searchEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });
});

it("requires current coverage and accepts only the negotiated selector", () => {
  const oldData = { path: "Docs", query: "needle", items: [] };
  expect(searchEndpoint.successSchema.safeParse({ data: oldData }).success).toBe(false);
  for (const completeness of ["complete", "partial"]) expect(searchEndpoint.successSchema.safeParse({ data: { ...oldData, completeness } }).success).toBe(true);
  for (const coverage of ["", "unknown", null]) expect(searchEndpoint.requestSchema.safeParse({ path: "", query: "x", coverage }).success).toBe(false);
  expect(searchEndpoint.requestSchema.parse({ path: "", query: "x", coverage: "bounded-v1" })).toEqual({ path: "", query: "x", coverage: "bounded-v1" });
});
