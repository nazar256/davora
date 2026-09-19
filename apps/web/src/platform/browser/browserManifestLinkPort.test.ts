import { describe, expect, it, vi } from "vitest";

import { createBrowserManifestLinkPort } from "./browserManifestLinkPort";

describe("createBrowserManifestLinkPort", () => {
  it("swaps an existing manifest link and restores the previous href", () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest" />';
    const createObjectURL = vi.fn(() => "blob:folder-manifest");
    const revokeObjectURL = vi.fn();
    const port = createBrowserManifestLinkPort(() => document, () => ({ createObjectURL, revokeObjectURL }));

    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const restore = port.attachManifest('{"name":"Plans"}');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link?.getAttribute("href")).toBe("blob:folder-manifest");

    restore();
    expect(link?.getAttribute("href")).toBe("/manifest.webmanifest");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:folder-manifest");

    restore();
    expect(link?.getAttribute("href")).toBe("/manifest.webmanifest");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("creates a manifest link when none exists and removes it on restore", () => {
    document.head.innerHTML = "";
    const createObjectURL = vi.fn(() => "blob:folder-manifest");
    const revokeObjectURL = vi.fn();
    const port = createBrowserManifestLinkPort(() => document, () => ({ createObjectURL, revokeObjectURL }));

    const restore = port.attachManifest('{"name":"Plans"}');
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');

    expect(link?.getAttribute("href")).toBe("blob:folder-manifest");

    restore();
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:folder-manifest");
  });

  it("serializes the manifest into a JSON blob", () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest" />';
    const blobs: Blob[] = [];
    const port = createBrowserManifestLinkPort(
      () => document,
      () => ({
        createObjectURL: (blob: Blob) => { blobs.push(blob); return "blob:folder-manifest"; },
        revokeObjectURL: () => undefined
      })
    );

    const restore = port.attachManifest('{"name":"Plans"}');
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("application/manifest+json");
    restore();
  });
});
