import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createNextcloudDestinationPolicy, normalizeNextcloudAllowedHosts } from "../src/security/nextcloudDestinationPolicy";
import { NextcloudClient } from "../src/nextcloud/client";

const production = () => createNextcloudDestinationPolicy({
  runtimeMode: "production",
  allowLocalNextcloud: false,
  allowedHosts: ["nextcloud.example.invalid"]
});

describe("Nextcloud destination policy", () => {
  it.each([
    "https://localhost",
    "https://foo.localhost",
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://192.168.1.10",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[fd00::1]",
    "https://metadata.google.internal",
    "http://nextcloud.example.invalid",
    "https://nextcloud.example.invalid:444",
    "https://user:pass@nextcloud.example.invalid",
    "https://nextcloud.example.invalid/?x=1",
    "https://not-nextcloud.example.invalid",
    "https://nextcloud.example.invalid."
  ])("rejects %s without invoking fetch", (rawUrl) => {
    const fetchMock = vi.fn<typeof fetch>();
    const policy = createNextcloudDestinationPolicy({
      runtimeMode: "production",
      allowLocalNextcloud: false,
      allowedHosts: ["nextcloud.example.invalid"]
    }, fetchMock);
    expect(() => policy.assertAllowed(new URL(rawUrl))).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only the exact normalized production hostname", () => {
    expect(() => production().assertAllowed(new URL("https://nextcloud.example.invalid"))).not.toThrow();
    expect(normalizeNextcloudAllowedHosts(["NEXTCLOUD.OWNHOST.TOP"])).toEqual(["nextcloud.example.invalid"]);
  });

  it("allows arbitrary public production hostnames only in explicit open mode", () => {
    const openPolicy = createNextcloudDestinationPolicy({
      runtimeMode: "production",
      allowLocalNextcloud: false,
      allowedHosts: [],
      allowAnyHost: true
    });
    expect(() => openPolicy.assertAllowed(new URL("https://cloud.example.net"))).not.toThrow();
    expect(() => openPolicy.assertAllowed(new URL("https://127.0.0.1"))).toThrow();
    expect(() => openPolicy.assertAllowed(new URL("https://metadata.google.internal"))).toThrow();
    expect(() => openPolicy.assertAllowed(new URL("http://cloud.example.net"))).toThrow();
  });

  it.each(["internal", "invalid", "example", "test", "home.arpa"])("rejects reserved suffix .%s in config and destination", (suffix) => {
    const host = suffix === "home.arpa" ? `cloud.${suffix}` : `cloud.${suffix}`;
    expect(() => normalizeNextcloudAllowedHosts([host])).toThrow();
    expect(() => production().assertAllowed(new URL(`https://${host}`))).toThrow();
  });

  it.each(["localhost", "127.0.0.1", "[::1]"]) (
    "allows development localhost %s only with the explicit gate",
    (hostname) => {
      const policy = createNextcloudDestinationPolicy({ runtimeMode: "development", allowLocalNextcloud: true, allowedHosts: [] });
      expect(() => policy.assertAllowed(new URL(`http://${hostname}:8787`))).not.toThrow();
      expect(() => createNextcloudDestinationPolicy({ runtimeMode: "development", allowLocalNextcloud: false, allowedHosts: [] }).assertAllowed(new URL(`http://${hostname}:8787`))).toThrow();
    }
  );

  it("guards every NextcloudClient request immediately before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    const client = new NextcloudClient({
      baseUrl: "https://nextcloud.example.invalid",
      username: "alice",
      appPassword: "password",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024,
      maxTextFileBytes: 1024
    }, fetchMock, production());
    await expect(client.getMetadata("")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
    const deniedClient = new NextcloudClient({
      baseUrl: "https://localhost",
      username: "alice",
      appPassword: "password",
      rootPath: ".davora-agent-test",
      maxFileBytes: 1024,
      maxTextFileBytes: 1024
    }, fetchMock, production());
    await expect(deniedClient.getMetadata("")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every production NextcloudClient construction behind the policy", () => {
    for (const sourceFile of ["apps/worker/src/accounts/service.ts", "apps/worker/src/files/createFileBackend.ts"]) {
      const source = readFileSync(resolve(process.cwd(), "..", "..", sourceFile), "utf8");
      expect(source).toMatch(/new NextcloudClient\([\s\S]*destinationPolicy/);
    }
  });

  it("guards every WebDAV method before the first denied fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new NextcloudClient({ baseUrl: "https://127.0.0.1", username: "alice", appPassword: "password", rootPath: ".davora-agent-test", maxFileBytes: 1024, maxTextFileBytes: 1024 }, fetchMock, production());
    const operations: Array<() => Promise<unknown>> = [
      () => client.listFolder(""), () => client.getMetadata(""), () => client.readFile(""), () => client.readOriginal(""),
      () => client.streamOriginal(""), () => client.searchFiles("needle"), () => client.createFolder({ path: "", name: "new" }),
      () => client.uploadFile({ path: "", name: "new.txt", contentBase64: "", mimeType: "text/plain" }),
      () => client.moveResource({ path: "a", destinationPath: "b", overwrite: false }), () => client.copyResource({ path: "a", destinationPath: "b", overwrite: false }),
      () => client.deleteResource({ path: "a", confirmName: "a" })
    ];
    for (const operation of operations) await expect(operation()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow an internal redirect", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    const client = new NextcloudClient({ baseUrl: "https://nextcloud.example.invalid", username: "alice", appPassword: "password", rootPath: ".davora-agent-test", maxFileBytes: 1024, maxTextFileBytes: 1024 }, fetchMock, production());
    await expect(client.getMetadata("")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
});
