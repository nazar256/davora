import { describe, expect, it, vi } from "vitest";

import { executeUpload } from "./controller";
import {
  buildUploadPlan,
  type PlannedUploadFile,
  type UploadCandidate,
  type UploadFolderTarget
} from "./model";
import type {
  FolderCreationResult,
  UploadExecutionPorts,
  UploadFileResult
} from "./ports";

function file(name: string, webkitRelativePath?: string): UploadCandidate {
  return { name, size: 5, type: "text/plain", ...(webkitRelativePath ? { webkitRelativePath } : {}) };
}

function ports(overrides: Partial<UploadExecutionPorts<UploadCandidate>> = {}): UploadExecutionPorts<UploadCandidate> {
  return {
    signal: new AbortController().signal,
    isCurrent: () => true,
    createFolder: vi.fn(async () => ({ kind: "created" } as const)),
    publishFileState: vi.fn(() => true),
    prepareFile: vi.fn(async (
      _file: PlannedUploadFile<UploadCandidate>,
      onProgress: (loadedBytes: number, totalBytes: number) => boolean
    ) => {
      onProgress(5, 5);
      return { kind: "prepared", contentBase64: "YQ==" } as const;
    }),
    uploadFile: vi.fn(async (
      _file: PlannedUploadFile<UploadCandidate>,
      _content: string,
      onProgress: (loadedBytes: number, totalBytes: number) => boolean
    ) => {
      onProgress(4, 4);
      return { kind: "uploaded" } as const;
    }),
    refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
    ...overrides
  };
}

describe("executeUpload", () => {
  it("creates every folder before preparing and uploading files sequentially", async () => {
    const calls: string[] = [];
    const adapter = ports({
      createFolder: vi.fn(async (folder: UploadFolderTarget) => {
        calls.push(`folder:${folder.path}`);
        return { kind: "created" } as const;
      }),
      prepareFile: vi.fn(async (planned: PlannedUploadFile<UploadCandidate>) => {
        calls.push(`prepare:${planned.destinationPath}`);
        return { kind: "prepared", contentBase64: "YQ==" } as const;
      }),
      uploadFile: vi.fn(async (planned: PlannedUploadFile<UploadCandidate>) => {
        calls.push(`upload:${planned.destinationPath}`);
        return { kind: "uploaded" } as const;
      })
    });
    const plan = buildUploadPlan("", [file("a.txt", "Root/deep/a.txt"), file("b.txt", "Root/b.txt")]);

    const result = await executeUpload(plan, adapter);

    expect(calls).toEqual([
      "folder:Root",
      "folder:Root/deep",
      "prepare:Root/deep/a.txt",
      "upload:Root/deep/a.txt",
      "prepare:Root/b.txt",
      "upload:Root/b.txt"
    ]);
    expect(result).toMatchObject({ kind: "completed", createdFolderCount: 2, completedFileCount: 2, serverChanged: true });
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
  });

  it("tolerates explicit already-exists results without counting a server change", async () => {
    const adapter = ports({ createFolder: vi.fn(async () => ({ kind: "alreadyExists" } as const)) });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt", "Root/a.txt")]), adapter);

    expect(result).toMatchObject({ kind: "completed", createdFolderCount: 0, completedFileCount: 1, serverChanged: true });
  });

  it.each([0, 1])("stops on folder failure at index %i and refreshes only after accepted changes", async (failureIndex) => {
    let index = 0;
    const adapter = ports({
      createFolder: vi.fn(async () => index++ === failureIndex
        ? { kind: "failed", message: "folder failed" } as const
        : { kind: "created" } as const)
    });
    const plan = buildUploadPlan("", [file("a.txt", "Root/deep/a.txt")]);

    const result = await executeUpload(plan, adapter);

    expect(result).toMatchObject({ kind: "failed", stage: "createFolder", message: "folder failed", createdFolderCount: failureIndex });
    expect(adapter.prepareFile).not.toHaveBeenCalled();
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(failureIndex === 0 ? 0 : 1);
  });

  it("refreshes after a preparation failure only when folder creation changed the server", async () => {
    const adapter = ports({ prepareFile: vi.fn(async () => ({ kind: "failed", message: "read failed" } as const)) });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt", "Root/a.txt")]), adapter);

    expect(result).toMatchObject({ kind: "failed", stage: "prepareFile", completedFileCount: 0, createdFolderCount: 1 });
    expect(adapter.uploadFile).not.toHaveBeenCalled();
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
  });

  it("stops at the first upload failure with exact completed-file facts", async () => {
    const results: UploadFileResult[] = [{ kind: "uploaded" }, { kind: "failed", message: "upload failed" }];
    const adapter = ports({ uploadFile: vi.fn(async () => results.shift() ?? ({ kind: "uploaded" } as const)) });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt"), file("b.txt"), file("c.txt")]), adapter);

    expect(result).toMatchObject({ kind: "failed", stage: "uploadFile", completedFileCount: 1, message: "upload failed" });
    expect(adapter.prepareFile).toHaveBeenCalledTimes(2);
    expect(adapter.uploadFile).toHaveBeenCalledTimes(2);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])("stops on terminal folder result at index %i without refresh", async (terminalIndex) => {
    let index = 0;
    const adapter = ports({
      createFolder: vi.fn(async (): Promise<FolderCreationResult> => index++ === terminalIndex
        ? { kind: "sessionTerminated" }
        : { kind: "created" })
    });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt", "Root/deep/a.txt")]), adapter);

    expect(result.kind).toBe("sessionTerminated");
    expect(adapter.createFolder).toHaveBeenCalledTimes(terminalIndex + 1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("stops on terminal upload after prior success without refreshing", async () => {
    const results: UploadFileResult[] = [{ kind: "uploaded" }, { kind: "sessionTerminated" }];
    const adapter = ports({ uploadFile: vi.fn(async () => results.shift() ?? ({ kind: "uploaded" } as const)) });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt"), file("b.txt")]), adapter);

    expect(result).toMatchObject({ kind: "sessionTerminated", completedFileCount: 1 });
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("makes late preparation progress and results inert after supersession", async () => {
    let current = true;
    const adapter = ports({
      isCurrent: () => current,
      prepareFile: vi.fn(async (
        _planned: PlannedUploadFile<UploadCandidate>,
        onProgress: (loadedBytes: number, totalBytes: number) => boolean
      ) => {
        current = false;
        expect(onProgress(1, 5)).toBe(false);
        return { kind: "prepared", contentBase64: "YQ==" } as const;
      })
    });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.uploadFile).not.toHaveBeenCalled();
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("makes late upload progress and results inert after supersession", async () => {
    let current = true;
    const adapter = ports({
      isCurrent: () => current,
      uploadFile: vi.fn(async (
        _planned: PlannedUploadFile<UploadCandidate>,
        _content: string,
        onProgress: (loadedBytes: number, totalBytes: number) => boolean
      ) => {
        current = false;
        expect(onProgress(1, 5)).toBe(false);
        return { kind: "uploaded" } as const;
      })
    });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt")]), adapter);

    expect(result).toMatchObject({ kind: "superseded", completedFileCount: 0 });
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("stops when file-state publication rejects current ownership", async () => {
    const adapter = ports({ publishFileState: vi.fn(() => false) });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt"), file("b.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.prepareFile).not.toHaveBeenCalled();
  });

  it("does not publish success when refresh terminates or is superseded", async () => {
    const terminal = await executeUpload(buildUploadPlan("", [file("a.txt")]), ports({
      refreshFolder: vi.fn(async () => ({ kind: "sessionTerminated" } as const))
    }));
    let current = true;
    const supersededAdapter = ports({
      isCurrent: () => current,
      refreshFolder: vi.fn(async () => {
        current = false;
        return { kind: "completed" } as const;
      })
    });
    const superseded = await executeUpload(buildUploadPlan("", [file("a.txt")]), supersededAdapter);

    expect(terminal.kind).toBe("sessionTerminated");
    expect(superseded.kind).toBe("superseded");
  });

  it("stops immediately when its abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = ports({ signal: controller.signal });

    const result = await executeUpload(buildUploadPlan("", [file("a.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.createFolder).not.toHaveBeenCalled();
    expect(adapter.prepareFile).not.toHaveBeenCalled();
  });
});
