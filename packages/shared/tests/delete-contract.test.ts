import { describe, expect, it } from "vitest";

import { assertDeleteResponseIdentity, deleteEndpoint } from "../src/index";

const request = { path: "Docs/a.txt", confirmName: "a.txt" };
const payload = { data: { result: { action: "delete" as const, parentPath: "Docs", path: "Docs/a.txt" } } };

describe("delete endpoint contract", () => {
  it("accepts a strict canonical request and identity-matched response", () => {
    expect(deleteEndpoint.requestSchema.parse(request)).toEqual(request);
    expect(assertDeleteResponseIdentity(request, deleteEndpoint.successSchema.parse(payload).data)).toEqual(payload.data);
  });

  it.each([
    { path: "", confirmName: "" },
    { path: "../a.txt", confirmName: "a.txt" },
    { path: "Docs/a.txt", confirmName: "a.txt", extra: true }
  ])("rejects malformed requests", (candidate) => {
    expect(deleteEndpoint.requestSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    { ...payload, extra: true },
    { data: { result: { ...payload.data.result, action: "copy" } } },
    { data: { result: { ...payload.data.result, item: { path: "Docs/a.txt", name: "a.txt", isFolder: false } } } }
  ])("rejects malformed success envelopes", (candidate) => {
    expect(deleteEndpoint.successSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    { ...payload.data, result: { ...payload.data.result, path: "Docs/b.txt" } },
    { ...payload.data, result: { ...payload.data.result, parentPath: "" } }
  ])("rejects mismatched success identity", (response) => {
    expect(() => assertDeleteResponseIdentity(request, response)).toThrow();
  });
});
