import { describe, expect, it, vi } from "vitest";

import type { MutationResult } from "@davora/shared";

import { createOperationContextToken, type OperationContextToken, type OperationIntent } from "../policy";
import { runUploadOrchestration } from "./orchestration";
import type { UploadOrchestrationPorts } from "./orchestrationPorts";
import { buildUploadPlan, type PlannedUploadFile, type UploadCandidate, type UploadFolderTarget } from "./model";

function file(name: string, size = 5, webkitRelativePath?: string): UploadCandidate {
  return { name, size, type: "text/plain", ...(webkitRelativePath ? { webkitRelativePath } : {}) };
}

function mutationResult(path: string): MutationResult {
  return {
    action: "upload",
    parentPath: "",
    path,
    item: { path, name: path.split("/").pop() ?? path, isFolder: false }
  };
}

function createScope(overrides: Partial<{ current: boolean; aborted: boolean }> = {}) {
  const controller = new AbortController();
  let current = overrides.current ?? true;
  if (overrides.aborted) {
    controller.abort();
  }
  return {
    controller,
    setCurrent(next: boolean) {
      current = next;
    },
    scope: {
      signal: controller.signal,
      isCurrent: () => current && !controller.signal.aborted,
      release: vi.fn()
    }
  };
}

type UploadOrchestrationTestFixture<TFile extends UploadCandidate = UploadCandidate> =
  UploadOrchestrationPorts<TFile> & {
    scope: ReturnType<typeof createScope>;
    transferEvents: string[];
    mutationCalls: string[];
  };

function ports<TFile extends UploadCandidate = UploadCandidate>(
  overrides: Partial<UploadOrchestrationPorts<TFile>> = {}
): UploadOrchestrationTestFixture<TFile> {
  const transferEvents: string[] = [];
  const mutationCalls: string[] = [];
  let nextId = 0;
  const scope = createScope();
  const defaultPorts: UploadOrchestrationPorts<TFile> = {
    registry: {
      acquire: vi.fn(() => scope.scope)
    },
    transfers: {
      createId: vi.fn(() => `transfer-${nextId += 1}`),
      enqueue: vi.fn(() => { transferEvents.push("enqueue"); }),
      beginPreparation: vi.fn((id: string, _totalBytes: number) => { transferEvents.push(`prepare:${id}`); }),
      reportPreparationProgress: vi.fn((id: string, loaded: number, total: number) => {
        transferEvents.push(`prepare-progress:${id}:${loaded}/${total}`);
      }),
      beginTransfer: vi.fn((id: string) => { transferEvents.push(`transfer:${id}`); }),
      reportUploadProgress: vi.fn((id: string, loaded: number, total: number) => {
        transferEvents.push(`upload-progress:${id}:${loaded}/${total}`);
      }),
      complete: vi.fn((id: string) => { transferEvents.push(`complete:${id}`); }),
      failActive: vi.fn((ids: ReadonlySet<string>, message: string) => {
        transferEvents.push(`fail:${[...ids].join(",")}:${message}`);
      })
    },
    mutations: {
      begin: vi.fn((_context: OperationContextToken) => { mutationCalls.push("begin"); }),
      finish: vi.fn((_context: OperationContextToken) => { mutationCalls.push("finish"); }),
      createFolder: vi.fn(async (
        _folder: UploadFolderTarget,
        _context: OperationContextToken,
        _intent: OperationIntent
      ) => ({ kind: "created" } as const)),
      uploadFile: vi.fn(async (
        planned: PlannedUploadFile<TFile>,
        _contentBase64: string,
        _context: OperationContextToken,
        _intent: OperationIntent,
        _onProgress: (loadedBytes: number, totalBytes: number) => void,
        _signal: AbortSignal
      ) => {
        mutationCalls.push(`upload:${planned.destinationPath}`);
        return { kind: "uploaded", result: mutationResult(planned.destinationPath) } as const;
      }),
      refreshFolder: vi.fn(async (_basePath: string) => ({ kind: "completed" } as const))
    },
    selection: {
      syncWithMutation: vi.fn()
    },
    presentation: {
      reportPlanError: vi.fn(),
      reportSuccess: vi.fn(),
      reportFailure: vi.fn(),
      reportUnexpectedError: vi.fn(),
      shouldReportUnexpectedError: vi.fn(() => true)
    },
    files: {
      prepare: vi.fn(async (
        _file: TFile,
        onProgress: (loadedBytes: number, totalBytes: number) => boolean,
        _signal: AbortSignal
      ) => {
        onProgress(5, 5);
        return { kind: "prepared", contentBase64: "YQ==" } as const;
      })
    }
  };

  return {
    ...defaultPorts,
    ...overrides,
    registry: overrides.registry ?? defaultPorts.registry,
    transfers: { ...defaultPorts.transfers, ...overrides.transfers },
    mutations: { ...defaultPorts.mutations, ...overrides.mutations },
    selection: { ...defaultPorts.selection, ...overrides.selection },
    presentation: { ...defaultPorts.presentation, ...overrides.presentation },
    files: { ...defaultPorts.files, ...overrides.files },
    scope,
    transferEvents,
    mutationCalls
  };
}

function input(files: readonly UploadCandidate[], source: "picker" | "drop" = "picker") {
  return {
    files,
    source,
    basePath: "",
    locationLabel: "/",
    accountId: "account-a",
    context: createOperationContextToken()
  };
}

describe("runUploadOrchestration", () => {
  it("uploads picker files and reports success without synchronizing multi-file selection", async () => {
    const adapter = ports();

    await runUploadOrchestration(input([file("alpha.txt"), file("beta.txt")], "picker"), adapter);

    expect(adapter.presentation.reportSuccess).toHaveBeenCalledWith("Uploaded 2 files into /");
    expect(adapter.selection.syncWithMutation).not.toHaveBeenCalled();
    expect(adapter.mutations.begin).toHaveBeenCalledTimes(1);
    expect(adapter.mutations.finish).toHaveBeenCalledTimes(1);
    expect(adapter.scope.scope.release).toHaveBeenCalledTimes(1);
  });

  it("uploads dropped files with the drag-and-drop success suffix", async () => {
    const adapter = ports();

    await runUploadOrchestration(input([file("dropped.txt")], "drop"), adapter);

    expect(adapter.presentation.reportSuccess).toHaveBeenCalledWith("Uploaded 1 file into / via drag and drop");
    expect(adapter.selection.syncWithMutation).toHaveBeenCalledTimes(1);
  });

  it("reports transfer progress through preparation and upload stages", async () => {
    const adapter = ports({
      files: {
        prepare: vi.fn(async (
          _file: UploadCandidate,
          onProgress: (loadedBytes: number, totalBytes: number) => boolean,
          _signal: AbortSignal
        ) => {
          onProgress(2, 5);
          onProgress(5, 5);
          return { kind: "prepared", contentBase64: "YQ==" } as const;
        })
      },
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async () => ({ kind: "created" } as const)),
        uploadFile: vi.fn(async (
          planned: PlannedUploadFile<UploadCandidate>,
          _content: string,
          _context: OperationContextToken,
          _intent: OperationIntent,
          onProgress: (loadedBytes: number, totalBytes: number) => void
        ) => {
          onProgress(3, 5);
          return { kind: "uploaded", result: mutationResult(planned.destinationPath) } as const;
        }),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      }
    });

    await runUploadOrchestration(input([file("alpha.txt", 5)]), adapter);

    expect(adapter.transfers.beginPreparation).toHaveBeenCalledWith("transfer-1", 5);
    expect(adapter.transfers.reportPreparationProgress).toHaveBeenCalledWith("transfer-1", 2, 5);
    expect(adapter.transfers.beginTransfer).toHaveBeenCalledWith("transfer-1");
    expect(adapter.transfers.reportUploadProgress).toHaveBeenCalledWith("transfer-1", 3, 5);
    expect(adapter.transfers.complete).toHaveBeenCalledWith("transfer-1");
  });

  it("keeps duplicate destinations as distinct terminal transfer records on partial failure", async () => {
    const presentationEvents: string[] = [];
    let uploadIndex = 0;
    const adapter = ports({
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async () => ({ kind: "created" } as const)),
        uploadFile: vi.fn(async (planned: PlannedUploadFile<UploadCandidate>) => {
          uploadIndex += 1;
          if (uploadIndex === 2) {
            return { kind: "failed", message: "Second duplicate failed" } as const;
          }
          return { kind: "uploaded", result: mutationResult(planned.destinationPath) } as const;
        }),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      },
      presentation: {
        reportPlanError: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn((status, error) => {
          if (status) presentationEvents.push("status");
          if (error) presentationEvents.push("error");
        }),
        reportUnexpectedError: vi.fn(),
        shouldReportUnexpectedError: vi.fn(() => true)
      }
    });

    await runUploadOrchestration(input([file("same.txt"), file("same.txt")]), adapter);

    expect(adapter.presentation.reportFailure).toHaveBeenCalledWith(
      "Upload stopped after 1 file of 2 into /",
      expect.objectContaining({ message: "Second duplicate failed" })
    );
    expect(adapter.transfers.complete).toHaveBeenCalledTimes(1);
    expect(adapter.transfers.failActive).toHaveBeenCalledWith(
      new Set(["transfer-1", "transfer-2"]),
      "Second duplicate failed"
    );
    expect(presentationEvents).toEqual(["status", "error"]);
  });

  it("fails active transfers with the context-changed message when superseded", async () => {
    const scope = createScope();
    const adapter = ports({
      registry: {
        acquire: vi.fn(() => scope.scope)
      },
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async () => ({ kind: "created" } as const)),
        uploadFile: vi.fn(async () => {
          scope.setCurrent(false);
          return { kind: "uploaded", result: mutationResult("late.txt") } as const;
        }),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      }
    });

    await runUploadOrchestration(input([file("alpha.txt")]), adapter);

    expect(adapter.presentation.reportSuccess).not.toHaveBeenCalled();
    expect(adapter.transfers.failActive).toHaveBeenCalledWith(
      new Set(["transfer-1"]),
      "Upload stopped because its account or connection context changed."
    );
  });

  it("fails active transfers without publishing success when refresh terminates the session", async () => {
    const adapter = ports({
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async () => ({ kind: "created" } as const)),
        uploadFile: vi.fn(async (planned: PlannedUploadFile<UploadCandidate>) => (
          { kind: "uploaded", result: mutationResult(planned.destinationPath) } as const
        )),
        refreshFolder: vi.fn(async () => ({ kind: "sessionTerminated" } as const))
      }
    });

    await runUploadOrchestration(input([file("alpha.txt")]), adapter);

    expect(adapter.presentation.reportSuccess).not.toHaveBeenCalled();
    expect(adapter.transfers.failActive).toHaveBeenCalledWith(
      new Set(["transfer-1"]),
      "Upload stopped because its account or connection context changed."
    );
  });

  it("does not acquire a request scope when the registry rejects ownership", async () => {
    const adapter = ports({
      registry: {
        acquire: vi.fn(() => undefined)
      }
    });

    await runUploadOrchestration(input([file("alpha.txt")]), adapter);

    expect(adapter.mutations.begin).not.toHaveBeenCalled();
    expect(adapter.transfers.enqueue).not.toHaveBeenCalled();
  });

  it("reports plan errors without starting transfers or mutations", async () => {
    const adapter = ports();

    await runUploadOrchestration({
      ...input([file("alpha.txt")]),
      basePath: "../bad"
    }, adapter);

    expect(adapter.presentation.reportPlanError).toHaveBeenCalledWith(expect.any(Error));
    expect(adapter.registry.acquire).not.toHaveBeenCalled();
    expect(adapter.mutations.begin).not.toHaveBeenCalled();
  });

  it("coordinates begin and finish mutation even when upload throws", async () => {
    const adapter = ports({
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async () => {
          throw new Error("Unexpected planner failure");
        }),
        uploadFile: vi.fn(),
        refreshFolder: vi.fn()
      },
      presentation: {
        reportPlanError: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
        reportUnexpectedError: vi.fn(),
        shouldReportUnexpectedError: vi.fn(() => true)
      }
    });

    await runUploadOrchestration(input([file("alpha.txt", 5, "Folder/nested.txt")]), adapter);

    expect(adapter.mutations.begin).toHaveBeenCalledTimes(1);
    expect(adapter.mutations.finish).toHaveBeenCalledTimes(1);
    expect(adapter.presentation.reportUnexpectedError).toHaveBeenCalledWith(expect.objectContaining({ message: "Unexpected planner failure" }));
  });

  it("never forwards prepared file content through presentation or transfer ports", async () => {
    const secret = "c2VjcmV0LXRva2Vu";
    const adapter = ports({
      files: {
        prepare: vi.fn(async () => ({ kind: "prepared", contentBase64: secret } as const))
      }
    });

    await runUploadOrchestration(input([file("secret.txt")]), adapter);

    for (const call of [
      ...vi.mocked(adapter.presentation.reportSuccess).mock.calls,
      ...vi.mocked(adapter.presentation.reportFailure).mock.calls,
      ...vi.mocked(adapter.presentation.reportUnexpectedError).mock.calls,
      ...vi.mocked(adapter.transfers.failActive).mock.calls
    ]) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});

describe("executeUpload integration through orchestration", () => {
  it("uses the same ordered execution facts as the controller for directory uploads", async () => {
    const calls: string[] = [];
    const adapter = ports({
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(async (folder: UploadFolderTarget) => {
          calls.push(`folder:${folder.path}`);
          return { kind: "created" } as const;
        }),
        uploadFile: vi.fn(async (planned: PlannedUploadFile<UploadCandidate>) => {
          calls.push(`upload:${planned.destinationPath}`);
          return { kind: "uploaded", result: mutationResult(planned.destinationPath) } as const;
        }),
        refreshFolder: vi.fn(async () => {
          calls.push("refresh");
          return { kind: "completed" } as const;
        })
      }
    });

    await runUploadOrchestration(input([
      file("a.txt", 5, "Root/deep/a.txt"),
      file("b.txt", 5, "Root/b.txt")
    ]), adapter);

    expect(calls).toEqual([
      "folder:Root",
      "folder:Root/deep",
      "upload:Root/deep/a.txt",
      "upload:Root/b.txt",
      "refresh"
    ]);
    expect(buildUploadPlan("", [file("a.txt", 5, "Root/deep/a.txt"), file("b.txt", 5, "Root/b.txt")]).folders).toHaveLength(2);
  });
});
