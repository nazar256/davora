import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  assertCreateFolderResponseIdentity,
  assertUploadResponseIdentity,
  createFolderEndpoint,
  uploadEndpoint
} from "../src/index";

const folderRequest = { path: "Docs", name: "New" };
const folderPayload = {
  data: {
    result: {
      action: "createFolder" as const,
      parentPath: "Docs",
      path: "Docs/New",
      item: { path: "Docs/New", name: "New", isFolder: true as const }
    }
  }
};
const uploadRequest = { path: "Docs/New", name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" };
const uploadPayload = {
  data: {
    result: {
      action: "upload" as const,
      parentPath: "Docs/New",
      path: "Docs/New/a.txt",
      item: { path: "Docs/New/a.txt", name: "a.txt", isFolder: false as const, mimeType: "text/plain" }
    }
  }
};

const legacyCanonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseUploadContent(contentBase64: string) {
  return uploadEndpoint.requestSchema.safeParse({ ...uploadRequest, contentBase64 });
}

describe("create-folder endpoint contract", () => {
  it("accepts root-parent requests and identity-matched strict responses", () => {
    expect(createFolderEndpoint.requestSchema.parse({ path: "", name: "New" })).toEqual({ path: "", name: "New" });
    expect(assertCreateFolderResponseIdentity(folderRequest, createFolderEndpoint.successSchema.parse(folderPayload).data)).toEqual(folderPayload.data);
  });

  it.each([
    { path: "../Docs", name: "New" },
    { path: "Docs", name: "" },
    { path: "Docs", name: "a/b" },
    { path: "Docs", name: ".." },
    { path: "Docs", name: "New", extra: true }
  ])("rejects malformed folder requests", (request) => {
    expect(createFolderEndpoint.requestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    { ...folderPayload, extra: true },
    { data: { result: { ...folderPayload.data.result, action: "upload" } } },
    { data: { result: { ...folderPayload.data.result, item: { ...folderPayload.data.result.item, isFolder: false } } } }
  ])("rejects malformed folder responses", (payload) => {
    expect(createFolderEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    { ...folderPayload.data, result: { ...folderPayload.data.result, parentPath: "" } },
    { ...folderPayload.data, result: { ...folderPayload.data.result, path: "Docs/Other" } },
    { ...folderPayload.data, result: { ...folderPayload.data.result, item: { ...folderPayload.data.result.item, path: "Docs/Other" } } }
  ])("rejects mismatched folder response identity", (response) => {
    expect(() => assertCreateFolderResponseIdentity(folderRequest, response)).toThrow();
  });
});

describe("upload endpoint contract", () => {
  it("accepts canonical base64 uploads and identity-matched strict responses", () => {
    expect(uploadEndpoint.requestSchema.parse(uploadRequest)).toEqual(uploadRequest);
    expect(assertUploadResponseIdentity(uploadRequest, uploadEndpoint.successSchema.parse(uploadPayload).data)).toEqual(uploadPayload.data);
  });

  it.each([
    { ...uploadRequest, path: "../Docs" },
    { ...uploadRequest, name: "a/b.txt" },
    { ...uploadRequest, name: "" },
    { ...uploadRequest, contentBase64: "not base64" },
    { ...uploadRequest, extra: true }
  ])("rejects malformed upload requests", (request) => {
    expect(uploadEndpoint.requestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    { ...uploadPayload, extra: true },
    { data: { result: { ...uploadPayload.data.result, action: "copy" } } },
    { data: { result: { ...uploadPayload.data.result, item: { ...uploadPayload.data.result.item, isFolder: true } } } }
  ])("rejects malformed upload responses", (payload) => {
    expect(uploadEndpoint.successSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    { ...uploadPayload.data, result: { ...uploadPayload.data.result, parentPath: "Docs" } },
    { ...uploadPayload.data, result: { ...uploadPayload.data.result, path: "Docs/New/b.txt" } },
    { ...uploadPayload.data, result: { ...uploadPayload.data.result, item: { ...uploadPayload.data.result.item, name: "b.txt" } } }
  ])("rejects mismatched upload response identity", (response) => {
    expect(() => assertUploadResponseIdentity(uploadRequest, response)).toThrow();
  });

  it("accepts a 4 MiB upload without throwing during validation", () => {
    const contentBase64 = Buffer.alloc(4 * 1024 * 1024, 0x61).toString("base64");

    expect(() => parseUploadContent(contentBase64)).not.toThrow();
    expect(parseUploadContent(contentBase64).success).toBe(true);
  });

  it.each([
    ["invalid tail", (contentBase64: string) => `${contentBase64.slice(0, -1)}!`],
    ["invalid padding", (contentBase64: string) => `${contentBase64.slice(0, -2)}=A`]
  ])("rejects a same-size %s without throwing during validation", (_label, mutate) => {
    const validContentBase64 = Buffer.alloc(4 * 1024 * 1024, 0x61).toString("base64");
    const contentBase64 = mutate(validContentBase64);

    expect(() => parseUploadContent(contentBase64)).not.toThrow();
    expect(parseUploadContent(contentBase64).success).toBe(false);
  });

  it.each([
    "",
    "A",
    "AA",
    "AAA",
    "AAAA",
    "AA==",
    "AAA=",
    "YR==",
    "ABCD",
    "AAAAA",
    "A===",
    "AA=A",
    "AAAA\n",
    "YW-J",
    "YW_J",
    "éAAA"
  ])("preserves short-input compatibility for %j", (contentBase64) => {
    expect(parseUploadContent(contentBase64).success).toBe(legacyCanonicalBase64.test(contentBase64));
  });

  it("matches the legacy validator across bounded generated short inputs", () => {
    fc.assert(fc.property(fc.string({ maxLength: 24 }), (contentBase64) => {
      expect(parseUploadContent(contentBase64).success).toBe(legacyCanonicalBase64.test(contentBase64));
    }));
  });
});
