import { describe, expect, it, vi } from "vitest";

import { createFavouriteActionsPorts } from "./createFavouriteActionsPorts";

describe("createFavouriteActionsPorts", () => {
  it("wires browser sources into favourite action ports", async () => {
    const input = {
      listFiles: vi.fn(async () => ({ items: [] })),
      cacheFolder: vi.fn(),
      toDisplayPath: vi.fn((path: string) => `/${path}`),
      closeNavigationChrome: vi.fn(),
      navigateToPath: vi.fn(),
      openFile: vi.fn(async () => undefined),
      setStatus: vi.fn(),
      reportListError: vi.fn()
    };
    const ports = createFavouriteActionsPorts(input);
    const entry = { path: "Projects", name: "Projects", isFolder: true };

    await ports.resolve.listFiles("", "session");
    ports.resolve.cacheFolder("alpha-cache", "", [entry]);
    ports.resolve.toDisplayPath("Projects");
    ports.open.closeNavigationChrome();
    ports.open.navigateToPath("Projects");
    await ports.open.openFile(entry, { preferFolderAudioPlayer: true });
    ports.surface.setStatus("ready");
    ports.surface.reportListError(new Error("broken"));

    expect(input.listFiles).toHaveBeenCalledWith("", "session");
    expect(input.cacheFolder).toHaveBeenCalledWith("alpha-cache", "", [entry]);
    expect(input.toDisplayPath).toHaveBeenCalledWith("Projects");
    expect(input.closeNavigationChrome).toHaveBeenCalled();
    expect(input.navigateToPath).toHaveBeenCalledWith("Projects");
    expect(input.openFile).toHaveBeenCalledWith(entry, { preferFolderAudioPlayer: true });
    expect(input.setStatus).toHaveBeenCalledWith("ready");
    expect(input.reportListError).toHaveBeenCalledWith(new Error("broken"));
  });
});
