import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../lib/api";
import { createBrowserOperationRuntime } from "./browserOperationRuntime";

const mocks = {
  createFolder: vi.fn<typeof import("../../lib/api").createFolder>(),
  deleteFile: vi.fn<typeof import("../../lib/api").deleteFile>(),
  uploadFileWithProgress: vi.fn<typeof import("../../lib/api").uploadFileWithProgress>(),
  moveFile: vi.fn<typeof import("../../lib/api").moveFile>(),
  copyFile: vi.fn<typeof import("../../lib/api").copyFile>(),
  listFiles: vi.fn<typeof import("../../lib/api").listFiles>(),
  prepareDownloadFile: vi.fn<typeof import("../../lib/api").prepareDownloadFile>(),
  fetchDownloadBlob: vi.fn<typeof import("../../lib/api").fetchDownloadBlob>(),
  triggerBrowserDownload: vi.fn<typeof import("../../lib/api").triggerBrowserDownload>(),
  downloadSelectionAsZip: vi.fn<typeof import("../../lib/batchDownload").downloadSelectionAsZip>(),
  createBrowserUploadFileContent: vi.fn<typeof import("../upload/browserUploadFileContent").createBrowserUploadFileContent>(() => ({ prepare: vi.fn() }))
};

const createRuntime = () => createBrowserOperationRuntime(mocks);

describe("browser operation runtime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards mutation requests exactly and extracts response results without retry", async () => {
    const item = { path: "Docs/new.txt", name: "new.txt", isFolder: false as const };
    const createResult = { action: "createFolder" as const, parentPath: "Docs", path: "Docs/new", item: { ...item, path: "Docs/new", name: "new", isFolder: true as const } };
    const deleteResult = { action: "delete" as const, parentPath: "Docs", path: "Docs/old" };
    const uploadResult = { action: "upload" as const, parentPath: "Docs", path: item.path, item };
    const copyResult = { action: "copy" as const, parentPath: "Docs", path: "Docs/a", destinationPath: "Docs/b" };
    const moveResult = { action: "move" as const, parentPath: "Docs", path: "Docs/a", destinationPath: "Docs/c" };
    mocks.createFolder.mockResolvedValueOnce({ result: createResult });
    mocks.deleteFile.mockResolvedValueOnce({ result: deleteResult });
    mocks.uploadFileWithProgress.mockResolvedValueOnce({ result: uploadResult });
    mocks.copyFile.mockResolvedValueOnce({ result: copyResult });
    mocks.moveFile.mockResolvedValueOnce({ result: moveResult });
    mocks.listFiles.mockResolvedValueOnce({ path: "Docs", items: [item] });
    const runtime = createRuntime();
    const progress = vi.fn();
    const controller = new AbortController();

    await expect(runtime.mutation.createFolder("/Docs", "new", "token")).resolves.toEqual(createResult);
    await expect(runtime.mutation.deleteFile("/Docs/old", "old", "token")).resolves.toEqual(deleteResult);
    await expect(runtime.mutation.uploadFile({ path: "/Docs", name: "new.txt", mimeType: "text/plain", contentBase64: "YQ==" }, "token", progress, controller.signal)).resolves.toEqual(uploadResult);
    await expect(runtime.mutation.copyOrMove("copy", "/Docs/a", "/Docs/b", "token")).resolves.toEqual(copyResult);
    await expect(runtime.mutation.copyOrMove("move", "/Docs/a", "/Docs/c", "token")).resolves.toEqual(moveResult);
    await expect(runtime.mutation.listDestination("/Docs", "token")).resolves.toEqual({ path: "Docs", items: [item] });

    expect(mocks.createFolder).toHaveBeenCalledWith({ path: "/Docs", name: "new" }, "token");
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: "/Docs/old", confirmName: "old" }, "token");
    expect(mocks.uploadFileWithProgress).toHaveBeenCalledWith(expect.objectContaining({ name: "new.txt" }), "token", progress, controller.signal);
    expect(mocks.copyFile).toHaveBeenCalledWith({ path: "/Docs/a", destinationPath: "/Docs/b" }, "token");
    expect(mocks.moveFile).toHaveBeenCalledWith({ path: "/Docs/a", destinationPath: "/Docs/c" }, "token");
    expect(mocks.createFolder).toHaveBeenCalledTimes(1);
  });

  it("forwards focused/batch downloads, save, upload content, progress, and signals", async () => {
    const blob = new Blob(["ok"]);
    const signal = new AbortController().signal;
    const progress = vi.fn();
    mocks.prepareDownloadFile.mockResolvedValueOnce({ blob, filename: "a.txt" });
    mocks.fetchDownloadBlob.mockResolvedValueOnce({ blob, filename: "a.txt" });
    mocks.listFiles.mockResolvedValueOnce({ path: "Docs", items: [] });
    mocks.downloadSelectionAsZip.mockResolvedValueOnce({
      blob,
      plan: { archiveName: "a.zip", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] }
    });
    const runtime = createRuntime();

    await runtime.download.prepareDownloadFile("/Docs/a.txt", "token", { onProgress: progress, signal });
    await runtime.download.fetchDownloadBlob("/Docs/a.txt", "token", { onProgress: progress, signal });
    await runtime.download.listFiles("/Docs", "token", signal);
    runtime.download.triggerBrowserDownload(blob, "a.txt");
    await runtime.batch.downloadSelectionAsZip({ roots: [], archiveLabel: "docs", listFiles: async () => ({ items: [] }), fetchFile: async () => ({ blob }) });
    runtime.download.saveDownload(blob, "saved.txt");

    expect(mocks.prepareDownloadFile).toHaveBeenCalledWith("/Docs/a.txt", "token", { onProgress: progress, signal });
    expect(mocks.fetchDownloadBlob).toHaveBeenCalledWith("/Docs/a.txt", "token", { onProgress: progress, signal });
    expect(mocks.listFiles).toHaveBeenCalledWith("/Docs", "token", signal);
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledWith(blob, "a.txt");
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledWith(blob, "saved.txt");
    expect(mocks.downloadSelectionAsZip).toHaveBeenCalledTimes(1);
    expect(mocks.createBrowserUploadFileContent).toHaveBeenCalled();
    expect(runtime.uploadFiles.prepare).toBeTypeOf("function");
  });

  it("creates abort handles and secure transfer IDs, and classifies errors without retry", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "transfer-id") });
    const runtime = createRuntime();
    const abort = runtime.request.createAbortHandle();
    expect(abort.signal.aborted).toBe(false);
    abort.abort();
    expect(abort.signal.aborted).toBe(true);
    expect(runtime.request.createTransferId()).toBe("transfer-id");
    expect(runtime.isUnauthorized(new ApiRequestError("expired", 401))).toBe(true);
    expect(runtime.isReconnectRequired(new ApiRequestError("reconnect", 409, "account_reconnect_required"))).toBe(true);
    expect(runtime.toErrorMessage(new Error("safe"), "fallback")).toBe("safe");
    expect(runtime.toErrorMessage({ secret: "hidden" }, "fallback")).toBe("fallback");
    vi.unstubAllGlobals();
  });
});
