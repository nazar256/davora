import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { buildBatchDownloadPlan } from "./batchDownload";

function file(path: string, size = 1): FileEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isFolder: false,
    size,
    mimeType: "text/plain"
  };
}

function folder(path: string): FileEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isFolder: true
  };
}

describe("buildBatchDownloadPlan", () => {
  it("expands folders and keeps mixed current-folder selections together in one archive", async () => {
    const listFiles = vi.fn(async (path: string) => {
      if (path === "Archive") {
        return {
          items: [file("Archive/photo.png", 5), folder("Archive/docs")]
        };
      }
      if (path === "Archive/docs") {
        return {
          items: [file("Archive/docs/readme.txt", 7)]
        };
      }
      return { items: [] };
    });

    const plan = await buildBatchDownloadPlan({
      entries: [folder("Archive"), file("notes.txt", 3)],
      currentPath: "",
      searchActive: false,
      listFiles
    });

    expect(plan.archiveName).toBe("davora-home-download.zip");
    expect(plan.directories).toEqual(["Archive", "Archive/docs"]);
    expect(plan.files).toEqual([
      { sourcePath: "Archive/photo.png", archivePath: "Archive/photo.png", size: 5 },
      { sourcePath: "Archive/docs/readme.txt", archivePath: "Archive/docs/readme.txt", size: 7 },
      { sourcePath: "notes.txt", archivePath: "notes.txt", size: 3 }
    ]);
    expect(plan.totalBytes).toBe(15);
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("drops descendant duplicates when a selected folder already covers them", async () => {
    const listFiles = vi.fn(async () => ({ items: [file("Projects/roadmap.txt", 2)] }));

    const plan = await buildBatchDownloadPlan({
      entries: [folder("Projects"), file("Projects/roadmap.txt", 2)],
      currentPath: "",
      searchActive: false,
      listFiles
    });

    expect(plan.files).toEqual([{ sourcePath: "Projects/roadmap.txt", archivePath: "Projects/roadmap.txt", size: 2 }]);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("uses full relative paths for search-result batch downloads", async () => {
    const plan = await buildBatchDownloadPlan({
      entries: [file("Projects/roadmap.txt", 2)],
      currentPath: "Archive",
      searchActive: true,
      listFiles: async () => ({ items: [] })
    });

    expect(plan.archiveName).toBe("projects-roadmap.txt.zip");
    expect(plan.files).toEqual([{ sourcePath: "Projects/roadmap.txt", archivePath: "Projects/roadmap.txt", size: 2 }]);
  });
});
