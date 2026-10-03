import { describe, expect, it } from "vitest";

import { z } from "zod";

import { fileEntrySchema, filesEndpoint, legacyFilesSuccessSchema } from "../src/index";

describe("files endpoint contract", () => {
  it("accepts the strict folder response envelope", () => {
    expect(filesEndpoint.successSchema.parse({
      data: {
        path: "Docs",
        completeness: "complete",
        items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false, size: 1, permissions: "RGDNVCK", ownerDisplayName: "Owner" }]
      }
    })).toEqual({
      data: {
        path: "Docs",
        completeness: "complete",
        items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false, size: 1, permissions: "RGDNVCK", ownerDisplayName: "Owner" }]
      }
    });
  });

  it.each([
    { data: { path: "Docs", items: [] } },
    { data: { path: "Docs", items: [{ path: "Docs/a.txt", name: "a.txt", isFolder: "no" }] } },
    { data: { path: "Docs", completeness: "unknown", items: [] } },
    { data: { path: "Docs", items: [], unexpected: true } },
    { path: "Docs", items: [] }
  ])("rejects malformed Worker envelopes", (payload) => {
    expect(filesEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });
});

describe("files request compatibility", () => {
  it.each([{ path: "Docs" }, { path: "Docs", listing: "complete-v1" }])("accepts supported request %j", (request) => {
    expect(filesEndpoint.requestSchema.parse(request)).toEqual(request);
  });
  it.each(["", "complete-v2", null])("rejects explicit unsupported selector %s", (listing) => {
    expect(filesEndpoint.requestSchema.safeParse({ path: "Docs", listing }).success).toBe(false);
  });
  it("keeps the legacy serializer compatible with the captured old strict envelope", () => {
    const oldClient = z.strictObject({ data: z.strictObject({ path: z.string(), items: z.array(fileEntrySchema) }) });
    const response = legacyFilesSuccessSchema.parse({ data: { path: "Docs", items: [] } });
    expect(oldClient.parse(response)).toEqual({ data: { path: "Docs", items: [] } });
    expect(oldClient.safeParse({ data: { path: "Docs", completeness: "partial", items: [] } }).success).toBe(false);
  });
});
