import { afterEach, describe, expect, it } from "vitest";

import { NextcloudClient } from "../src/nextcloud/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("nextcloud client", () => {
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
      baseUrl: "https://nextcloud.ownhost.top",
      username: "alice",
      appPassword: "app-pass",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024 * 1024,
      maxTextFileBytes: 64 * 1024
    });

    await expect(client.validateRoot()).resolves.toMatchObject({ path: "", name: ".davora-agent-test", isFolder: true });
    expect(fetchCalls).toEqual(["https://nextcloud.ownhost.top/remote.php/dav/files/alice/.davora-agent-test"]);
  });
});
