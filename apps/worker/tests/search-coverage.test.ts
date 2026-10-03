import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@davora/shared";

import { NextcloudFileBackend } from "../src/files/nextcloudFileBackend";
import { MockFileBackend } from "../src/files/mockFileBackend";
import { NextcloudClient } from "../src/nextcloud/client";
import { resetMockEntries } from "../src/mock/data";
import { testNextcloudPolicy } from "./support/workerApplicationHarness";

const folder = (path: string): FileEntry => ({ path, name: path.split("/").at(-1)!, isFolder: true });
const file = (path: string): FileEntry => ({ ...folder(path), isFolder: false });
const options = { baseUrl: "https://nextcloud.example.invalid", username: "alice", appPassword: "test-password", rootPath: "", maxFileBytes: 1024, maxTextFileBytes: 1024 };

function realBackend(listings: Record<string, FileEntry[]>, partial = false) {
  const client = new NextcloudClient(options, vi.fn<typeof fetch>(), testNextcloudPolicy);
  const list = vi.spyOn(client, "listFolder").mockImplementation(async (path = "") => {
    if (list.mock.calls.length > 50) throw new Error("51st folder listing exceeded the Free request bound");
    return { items: listings[path] ?? [], completeness: partial ? "partial" : "complete" };
  });
  return { backend: new NextcloudFileBackend(client), list };
}

afterEach(() => { vi.restoreAllMocks(); resetMockEntries(); });

describe("bounded search coverage regressions", () => {
  it("never attempts a 51st real-adapter listing", async () => {
    const { backend, list } = realBackend({ "": Array.from({ length: 60 }, (_, i) => folder(`folder-${i}`)) });
    await expect(backend.search("", "absent")).resolves.toEqual({ items: [], completeness: "partial" });
    expect(list).toHaveBeenCalledTimes(50);
  });

  it.each([{ items: [] }, { items: [file("Docs/needle.txt")] }])("preserves partial listing coverage even with few matches", async ({ items }) => {
    const { backend } = realBackend({ Docs: items }, true);
    expect(await backend.search("Docs", "needle")).toMatchObject({ completeness: "partial" });
  });

  it("reports an omitted descendant at the depth boundary", async () => {
    const { backend, list } = realBackend({ "": [folder("a")], a: [folder("a/b")], "a/b": [folder("a/b/c")], "a/b/c": [folder("a/b/c/d")] });
    await expect(backend.search("", "absent")).resolves.toEqual({ items: [], completeness: "partial" });
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("reports unexamined children after the twentieth match", async () => {
    const { backend } = realBackend({ Docs: Array.from({ length: 21 }, (_, i) => file(`Docs/needle-${i}.txt`)) });
    const result = await backend.search("Docs", "needle");
    expect(result.completeness).toBe("partial");
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(20);
  });

  it("never includes the selected folder or a sibling-prefix folder in mock scope", async () => {
    const backend = new MockFileBackend("search-scope");
    await backend.createFolder({ path: "", name: "Docs" });
    await backend.createFolder({ path: "", name: "Docs2" });
    await backend.upload({ path: "Docs2", name: "needle.txt", contentBase64: "YQ==" });
    await expect(backend.search("Docs", "needle")).resolves.toEqual({ items: [], completeness: "complete" });
    await expect(backend.search("Docs", "Docs")).resolves.toEqual({ items: [], completeness: "complete" });
  });
});
