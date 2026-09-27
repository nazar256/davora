import { afterEach, describe, expect, it, vi } from "vitest";

import { basename, fileEntrySchema, filesSuccessSchema } from "@davora/shared";

import { NextcloudClient } from "../src/nextcloud/client";
import { createNextcloudDestinationPolicy } from "../src/security/nextcloudDestinationPolicy";

const testNextcloudPolicy = createNextcloudDestinationPolicy({ runtimeMode: "production", allowLocalNextcloud: false, allowedHosts: ["nextcloud.example.invalid"] });

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("nextcloud client", () => {
  it("rejects an invalid list path before issuing a Nextcloud request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new NextcloudClient({
      baseUrl: "https://nextcloud.example.invalid",
      username: "alice",
      appPassword: "app-pass",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024 * 1024,
      maxTextFileBytes: 64 * 1024
    }, fetchMock, testNextcloudPolicy);

    await expect(client.listFolder("../private")).rejects.toThrow(/traversal/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the default global fetch before calling real Nextcloud validation", async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = (async function fetchWithRequiredThis(this: typeof globalThis, input: RequestInfo | URL) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
      }

      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/.davora-agent-test</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>.davora-agent-test</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
    }) as typeof fetch;

    const client = new NextcloudClient({
      baseUrl: "https://nextcloud.example.invalid",
      username: "alice",
      appPassword: "app-pass",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024 * 1024,
      maxTextFileBytes: 64 * 1024
    }, undefined, testNextcloudPolicy);

    await expect(client.validateRoot()).resolves.toMatchObject({ path: "", name: ".davora-agent-test", isFolder: true });
    expect(fetchCalls).toEqual(["https://nextcloud.example.invalid/remote.php/dav/files/alice/.davora-agent-test"]);
  });

  it("preserves literal percent characters in listed and downloaded WebDAV paths", async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      fetchCalls.push({ url, method });

      if (method === "PROPFIND") {
        return new Response(
          `<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:">
            <d:response>
              <d:href>/remote.php/dav/files/alice/.davora-agent-test/Photos/</d:href>
              <d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Photos</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
            </d:response>
            <d:response>
              <d:href>/remote.php/dav/files/alice/.davora-agent-test/Photos/100%25%20complete.txt</d:href>
              <d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>100% complete.txt</d:displayname><d:getcontenttype>text/plain</d:getcontenttype><d:getcontentlength>4</d:getcontentlength><d:resourcetype/></d:prop></d:propstat>
            </d:response>
          </d:multistatus>`,
          { status: 207 }
        );
      }

      return new Response("done", {
        status: 200,
        headers: {
          "content-type": "text/plain"
        }
      });
    }) as typeof fetch;

    const client = new NextcloudClient({
      baseUrl: "https://nextcloud.example.invalid",
      username: "alice",
      appPassword: "app-pass",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024 * 1024,
      maxTextFileBytes: 64 * 1024
    }, undefined, testNextcloudPolicy);

    await expect(client.listFolder("Photos")).resolves.toEqual([
      expect.objectContaining({
        path: "Photos/100% complete.txt",
        name: "100% complete.txt",
        isFolder: false
      })
    ]);
    await expect(client.download("Photos/100% complete.txt")).resolves.toMatchObject({
      metadata: expect.objectContaining({
        path: "Photos/100% complete.txt",
        name: "100% complete.txt"
      })
    });
    expect(fetchCalls.at(-1)).toEqual({
      method: "GET",
      url: "https://nextcloud.example.invalid/remote.php/dav/files/alice/.davora-agent-test/Photos/100%25%20complete.txt"
    });
  });
});

describe("nextcloud folder listing trust boundary", () => {
  const sandboxPrefix = "/remote.php/dav/files/alice/.davora-agent-test";

  const propfindResponse = (entries: Array<{ href: string; props: string }>) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries
      .map(
        (entry) =>
          `<d:response><d:href>${sandboxPrefix}${entry.href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>${entry.props}</d:prop></d:propstat></d:response>`
      )
      .join("")}</d:multistatus>`;

  const listWithXml = async (xml: string) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(xml, { status: 207 }));
    const client = new NextcloudClient({
      baseUrl: "https://nextcloud.example.invalid",
      username: "alice",
      appPassword: "app-pass",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024 * 1024,
      maxTextFileBytes: 64 * 1024
    }, fetchMock, testNextcloudPolicy);
    return client.listFolder("sub");
  };

  const fileProps = (displayname: string, extra = "") =>
    `<d:displayname>${displayname}</d:displayname><d:getcontenttype>text/plain</d:getcontenttype><d:resourcetype/>${extra}`;

  it("keeps a leading-space filename consistent when the server trims its displayname", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/%20file.txt", props: fileProps("file.txt", "<d:getcontentlength>4</d:getcontentlength>") }
    ]));

    expect(items).toEqual([
      expect.objectContaining({ path: "sub/ file.txt", name: " file.txt", size: 4 })
    ]);
    for (const item of items) {
      expect(fileEntrySchema.safeParse(item).success).toBe(true);
      expect(basename(item.path)).toBe(item.name);
    }
  });

  it("derives the entry name from the href when displayname uses a different Unicode normalization", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/e%CC%81.txt", props: fileProps("\u00e9.txt") }
    ]));

    expect(items).toEqual([
      expect.objectContaining({ path: "sub/e\u0301.txt", name: "e\u0301.txt" })
    ]);
    expect(items[0].path).toBe("sub/e\u0301.txt");
    expect(items[0].name).toBe("e\u0301.txt");
    expect(items[0].name).toBe(basename(items[0].path));
  });

  it("ignores control characters in displayname when the href basename is clean", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      {
        href: "/sub/weekly%20report/",
        props: "<d:displayname>weekly\u0007 report\u0006</d:displayname><d:resourcetype><d:collection/></d:resourcetype>"
      }
    ]));

    expect(items).toEqual([
      expect.objectContaining({ path: "sub/weekly report", name: "weekly report", isFolder: true })
    ]);
    expect(basename(items[0].path)).toBe(items[0].name);
  });

  it("prefers the href basename over a custom server displayname", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/doc.txt", props: fileProps("My Document") }
    ]));

    expect(items).toEqual([
      expect.objectContaining({ path: "sub/doc.txt", name: "doc.txt" })
    ]);
  });

  it("omits a non-finite getcontentlength instead of emitting an unserializable size", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/huge.bin", props: fileProps("huge.bin", `<d:getcontentlength>${"9".repeat(400)}</d:getcontentlength>`) }
    ]));

    expect(items).toEqual([
      expect.objectContaining({ path: "sub/huge.bin", name: "huge.bin" })
    ]);
    expect(items[0]).not.toHaveProperty("size");
    const roundTripped: unknown = JSON.parse(JSON.stringify(items));
    expect(filesSuccessSchema.safeParse({ data: { path: "sub", items: roundTripped } }).success).toBe(true);
  });

  it("skips entries whose href cannot be represented while keeping valid siblings", async () => {
    const items = await listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/a%252Fb.txt", props: fileProps("a%2Fb.txt") },
      { href: "/sub/%E9latin1.txt", props: fileProps("\u00e9latin1.txt") },
      { href: "/sub/ok.txt", props: fileProps("ok.txt") }
    ]));

    expect(items.map((item) => item.path)).toEqual(["sub/ok.txt"]);
  });

  it("still rejects a structurally wrong DAV href instead of silently skipping", async () => {
    await expect(listWithXml(propfindResponse([
      { href: "/sub/", props: "<d:displayname>sub</d:displayname><d:resourcetype><d:collection/></d:resourcetype>" },
      { href: "/sub/doc.txt", props: fileProps("doc.txt") }
    ]).replaceAll("/dav/files/alice/", "/dav/files/bob/"))).rejects.toThrow(/username mismatch/i);
  });
});
