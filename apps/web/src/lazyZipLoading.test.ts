import { afterEach, describe, expect, it, vi } from "vitest";

import { DIAGNOSTICS_SCHEMA_VERSION } from "./features/diagnostics/model";
import { emptyBugReportForm } from "./features/diagnostics/report/reportModel";
import type { FileEntry } from "@davora/shared";

const jsZipLoadError = new Error("jszip unavailable");

const file = (path: string): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false,
  size: 1,
  mimeType: "text/plain"
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("jszip");
});

describe("lazy JSZip loading", () => {
  it("keeps batch planning available while archive loading fails", async () => {
    vi.doMock("jszip", () => {
      return {
        get default() {
          throw jsZipLoadError;
        }
      };
    });

    const { buildBatchDownloadPlan, downloadSelectionAsZip } = await import("./lib/batchDownload");
    const options = {
      roots: [{ entry: file("notes.txt"), archiveRoot: "notes.txt" }],
      archiveLabel: "home",
      listFiles: async () => ({ completeness: "complete" as const, items: [] }),
      fetchFile: async () => ({ blob: new Blob(["content"]) })
    };

    await expect(buildBatchDownloadPlan(options)).resolves.toMatchObject({
      files: [{ sourcePath: "notes.txt" }]
    });
    await expect(downloadSelectionAsZip(options)).rejects.toThrow(jsZipLoadError);
  });

  it("keeps report preview available while archive loading fails", async () => {
    vi.doMock("jszip", () => {
      return {
        get default() {
          throw jsZipLoadError;
        }
      };
    });

    const { buildBugReportBundle, estimateReportBundle } = await import("./features/diagnostics/report/bundle");
    const input = {
      form: { ...emptyBugReportForm(), summary: "UI glitch" },
      sessions: [],
      generatedAt: "2026-01-02T00:00:00.000Z",
      appBuild: "test-build"
    };

    expect(estimateReportBundle(input.sessions)).toMatchObject({ sessionCount: 0, eventCount: 0 });
    await expect(buildBugReportBundle(input)).rejects.toThrow(jsZipLoadError);
    expect(DIAGNOSTICS_SCHEMA_VERSION).toBeTypeOf("number");
  });
});
