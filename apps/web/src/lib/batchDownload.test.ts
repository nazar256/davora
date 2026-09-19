import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { buildBatchDownloadPlan, downloadSelectionAsZip } from "./batchDownload";

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
      roots: [{ entry: folder("Archive"), archiveRoot: "Archive" }, { entry: file("notes.txt", 3), archiveRoot: "notes.txt" }],
      archiveLabel: "home",
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
      roots: [{ entry: folder("Projects"), archiveRoot: "Projects" }, { entry: file("Projects/roadmap.txt", 2), archiveRoot: "Projects/roadmap.txt" }],
      archiveLabel: "home",
      listFiles
    });

    expect(plan.files).toEqual([{ sourcePath: "Projects/roadmap.txt", archivePath: "Projects/roadmap.txt", size: 2 }]);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("uses full relative paths for search-result batch downloads", async () => {
    const plan = await buildBatchDownloadPlan({
      roots: [{ entry: file("Projects/roadmap.txt", 2), archiveRoot: "Projects/roadmap.txt" }],
      archiveLabel: "search-results",
      listFiles: async () => ({ items: [] })
    });

    expect(plan.archiveName).toBe("projects-roadmap.txt.zip");
    expect(plan.files).toEqual([{ sourcePath: "Projects/roadmap.txt", archivePath: "Projects/roadmap.txt", size: 2 }]);
  });

  it("keeps same-named search results from different folders at distinct archive paths", async () => {
    const plan = await buildBatchDownloadPlan({
      roots: [
        { entry: file("Projects/report.txt", 2), archiveRoot: "Projects/report.txt" },
        { entry: file("Archive/report.txt", 3), archiveRoot: "Archive/report.txt" }
      ],
      archiveLabel: "search-results",
      listFiles: async () => ({ items: [] })
    });

    expect(plan.archiveName).toBe("davora-search-results-download.zip");
    expect(plan.files.map((item) => item.archivePath)).toEqual(["Archive/report.txt", "Projects/report.txt"]);
  });
});

describe("downloadSelectionAsZip", () => {
  it("continues downloading after a single file fails and reports the failure", async () => {
    const listFiles = vi.fn(async () => ({ items: [] }));
    const fetchFile = vi.fn(async (path: string) => {
      if (path === "alpha.txt") {
        throw new Error("Permission denied");
      }
      return { blob: new Blob(["ok"], { type: "text/plain" }) };
    });

    const { blob, plan } = await downloadSelectionAsZip({
      roots: [{ entry: file("alpha.txt", 1), archiveRoot: "alpha.txt" }, { entry: file("beta.txt", 2), archiveRoot: "beta.txt" }],
      archiveLabel: "home",
      listFiles,
      fetchFile
    });

    expect(plan.failedFiles).toHaveLength(1);
    expect(plan.failedFiles[0]).toMatchObject({ sourcePath: "alpha.txt", error: "Permission denied" });
    expect(plan.files).toHaveLength(2);
    expect(blob.size).toBeGreaterThan(0);
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });

  it("continues downloading recursive folder siblings after one child fails", async () => {
    const listFiles = vi.fn(async (path: string) => {
      if (path === "Documents") {
        return {
          items: [file("Documents/good.txt", 2), file("Documents/bad%file.txt", 3)]
        };
      }
      return { items: [] };
    });
    const fetchFile = vi.fn(async (path: string) => {
      if (path === "Documents/bad%file.txt") {
        throw new Error("Path contains invalid percent-encoding.");
      }
      return { blob: new Blob(["ok"], { type: "text/plain" }) };
    });

    const { blob, plan } = await downloadSelectionAsZip({
      roots: [{ entry: folder("Documents"), archiveRoot: "Documents" }],
      archiveLabel: "home",
      listFiles,
      fetchFile
    });

    expect(plan.files).toEqual([
      { sourcePath: "Documents/good.txt", archivePath: "Documents/good.txt", size: 2 },
      { sourcePath: "Documents/bad%file.txt", archivePath: "Documents/bad%file.txt", size: 3 }
    ]);
    expect(plan.failedFiles).toEqual([
      { sourcePath: "Documents/bad%file.txt", error: "Path contains invalid percent-encoding." }
    ]);
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reports multiple failures when several files fail", async () => {
    const fetchFile = vi.fn(async () => {
      throw new Error("Network error");
    });

    const { plan } = await downloadSelectionAsZip({
      roots: [{ entry: file("a.txt", 1), archiveRoot: "a.txt" }, { entry: file("b.txt", 2), archiveRoot: "b.txt" }],
      archiveLabel: "home",
      listFiles: async () => ({ items: [] }),
      fetchFile
    });

    expect(plan.failedFiles).toHaveLength(2);
    expect(plan.failedFiles[0].error).toBe("Network error");
    expect(plan.failedFiles[1].error).toBe("Network error");
  });

  it("succeeds with empty failedFiles when all files download", async () => {
    const fetchFile = vi.fn(async () => ({ blob: new Blob(["content"]) }));

    const { plan } = await downloadSelectionAsZip({
      roots: [{ entry: file("ok.txt", 5), archiveRoot: "ok.txt" }],
      archiveLabel: "home",
      listFiles: async () => ({ items: [] }),
      fetchFile
    });

    expect(plan.failedFiles).toHaveLength(0);
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });
});
