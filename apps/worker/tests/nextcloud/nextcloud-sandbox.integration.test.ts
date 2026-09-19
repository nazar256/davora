import { beforeEach, describe, expect, it } from "vitest";

import { NextcloudClient } from "../../src/nextcloud/client";
import { testNextcloudPolicy, resetConnectedAccountStoreForTests } from "../support/workerApplicationHarness";

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});

describe("worker Nextcloud sandbox application", () => {
  it("creates the configured real Nextcloud root during validation when missing", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const existingPaths = new Set<string>();
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.ownhost.top",
        username: "ynvio",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test/docs",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });

        const path = decodeURIComponent(new URL(url).pathname.replace(/^.*\/files\/[^/]+\//, ""));
        if (init?.method === "PROPFIND") {
          if (!existingPaths.has(path)) {
            return new Response("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\"></d:multistatus>", { status: 404 });
          }
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/ynvio/${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${path.split("/").at(-1)}</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
        }
        if (init?.method === "MKCOL") {
          existingPaths.add(path);
          return new Response(null, { status: 201 });
        }
        return new Response(null, { status: 204 });
      },
      testNextcloudPolicy
    );

    const metadata = await client.validateRoot();

    expect(metadata.path).toBe("");
    expect(calls.filter((call) => call.method === "MKCOL").map((call) => call.url)).toEqual([
      "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test",
      "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs"
    ]);
  })

  it("creates only the missing leaf when an ancestor sandbox path already exists", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const existingPaths = new Set<string>([".davora-agent-test"]);
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.ownhost.top",
        username: "ynvio",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test/docs",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });

        const path = decodeURIComponent(new URL(url).pathname.replace(/^.*\/files\/[^/]+\//, ""));
        if (init?.method === "PROPFIND") {
          if (!existingPaths.has(path)) {
            return new Response("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\"></d:multistatus>", { status: 404 });
          }
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/ynvio/${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${path.split("/").at(-1)}</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
        }
        if (init?.method === "MKCOL") {
          existingPaths.add(path);
          return new Response(null, { status: 201 });
        }
        return new Response(null, { status: 204 });
      },
      testNextcloudPolicy
    );

    const metadata = await client.validateRoot();

    expect(metadata.path).toBe("");
    expect(calls.filter((call) => call.method === "MKCOL").map((call) => call.url)).toEqual([
      "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs"
    ]);
  })

  it("uses the sandbox root for real Nextcloud mutation requests", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.ownhost.top",
        username: "ynvio",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });
        return new Response(null, { status: 204 });
      },
      testNextcloudPolicy
    );

    await client.createFolder({ path: "docs", name: "nested" });
    await client.uploadFile({
      path: "docs",
      name: "source.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello world", "utf8").toString("base64")
    });
    await client.moveResource({ path: "docs/source.txt", destinationPath: "docs/renamed.txt" });
    await client.copyResource({ path: "docs/renamed.txt", destinationPath: "docs/copied.txt" });
    await client.deleteResource({ path: "docs/copied.txt", confirmName: "copied.txt" });

    expect(calls.filter((call) => ["MKCOL", "PUT", "MOVE", "COPY", "DELETE"].includes(call.method ?? ""))).toEqual([
      {
        method: "MKCOL",
        url: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/nested",
        destination: null
      },
      {
        method: "PUT",
        url: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/source.txt",
        destination: null
      },
      {
        method: "MOVE",
        url: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/source.txt",
        destination: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/renamed.txt"
      },
      {
        method: "COPY",
        url: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/renamed.txt",
        destination: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/copied.txt"
      },
      {
        method: "DELETE",
        url: "https://nextcloud.ownhost.top/remote.php/dav/files/ynvio/.davora-agent-test/docs/copied.txt",
        destination: null
      }
    ]);
  })
});

