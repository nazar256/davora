import { describe, expect, it } from "vitest";

import { assertMoveCopyResponseIdentity, copyEndpoint, moveEndpoint } from "../src/index";

const moveRequest = { path: "Docs/a.txt", destinationPath: "Archive/a.txt" };
const movePayload = {
  data: {
    result: {
      action: "move" as const,
      parentPath: "Archive",
      path: "Docs/a.txt",
      destinationPath: "Archive/a.txt",
      item: { path: "Archive/a.txt", name: "a.txt", isFolder: false }
    }
  }
};

describe("move and copy endpoint contracts", () => {
  it("accepts strict canonical requests and identity-matched success envelopes", () => {
    expect(moveEndpoint.requestSchema.parse(moveRequest)).toEqual(moveRequest);
    expect(assertMoveCopyResponseIdentity("move", moveRequest, moveEndpoint.successSchema.parse(movePayload).data)).toEqual(movePayload.data);
  });

  it.each([
    { path: "../escape.txt", destinationPath: "Archive/a.txt" },
    { path: "Docs/a.txt", destinationPath: "Archive/../a.txt" },
    { path: "Docs/a.txt", destinationPath: "Archive/a.txt", extra: true }
  ])("rejects malformed or noncanonical requests", (request) => {
    expect(moveEndpoint.requestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    { ...movePayload, extra: true },
    { data: { result: { ...movePayload.data.result, action: "copy" } } },
    { data: { result: { ...movePayload.data.result, extra: true } } },
    { data: { result: { ...movePayload.data.result, item: { ...movePayload.data.result.item, extra: true } } } }
  ])("rejects malformed move success envelopes", (payload) => {
    expect(moveEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["source", { ...movePayload.data, result: { ...movePayload.data.result, path: "Docs/other.txt" } }],
    ["destination", { ...movePayload.data, result: { ...movePayload.data.result, destinationPath: "Archive/other.txt" } }],
    ["parent", { ...movePayload.data, result: { ...movePayload.data.result, parentPath: "" } }],
    ["item", { ...movePayload.data, result: { ...movePayload.data.result, item: { ...movePayload.data.result.item, path: "Archive/other.txt" } } }]
  ])("rejects a success with mismatched %s identity", (_label, response) => {
    expect(() => assertMoveCopyResponseIdentity("move", moveRequest, response)).toThrow();
  });

  it("uses a copy-specific action contract", () => {
    const response = {
      result: { ...movePayload.data.result, action: "copy" as const }
    };
    expect(assertMoveCopyResponseIdentity("copy", moveRequest, copyEndpoint.successSchema.parse({ data: response }).data)).toEqual(response);
  });
});
