import { afterEach, describe, expect, it, vi } from "vitest";

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
