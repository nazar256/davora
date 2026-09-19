import type { MutationResult } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import { createBatchDeleteWorkflow } from "./model";
import { runActionDialogSubmitOrchestration, type ActionDialogSubmitInput } from "./orchestration";
import type { ActionDialogOrchestrationPorts } from "./orchestrationPorts";
import { issueMutationAttemptToken } from "../mutation/attempt";

function ownership(context: ReturnType<typeof createOperationContextToken>) {
  const attempt = issueMutationAttemptToken({
    workflowIdentity: 1, context, path: "", pathGeneration: 0, ownershipGeneration: 0,
    mountGeneration: 1, domainIdentity: "test", intent: { kind: "createFolder" }
  });
  return {
    attempt,
    isAttemptCurrent: vi.fn(() => true),
    failAttempt: vi.fn(),
    reportDeletePartial: vi.fn((..._args: Parameters<ActionDialogSubmitInput["reportDeletePartial"]>) => undefined),
    completeActionDialog: vi.fn(() => true)
  };
}

function mutationResult(path: string): MutationResult {
  return { action: "delete", parentPath: "", path };
}

type MutableFixture = ActionDialogOrchestrationPorts & {
  setContextAllowed(next: boolean): void;
  mutationCalls: string[];
};

function ports(overrides: Partial<ActionDialogOrchestrationPorts> = {}): MutableFixture {
  const mutationCalls: string[] = [];
  let contextAllowed = true;
  const defaultPorts: ActionDialogOrchestrationPorts = {
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isContextAllowed: vi.fn(() => contextAllowed)
    },
    session: {
      hasSession: vi.fn(() => true),
      isUnauthorized: vi.fn((error: unknown) => error instanceof ApiRequestError && error.status === 401),
      isReconnectRequired: vi.fn((error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required")
    },
    mutations: {
      begin: vi.fn(() => { mutationCalls.push("begin"); }),
      finish: vi.fn(() => { mutationCalls.push("finish"); })
    },
    mutation: {
      execute: vi.fn(async (runner: () => Promise<MutationResult>) => {
        mutationCalls.push("single");
        return runner();
      })
    },
    api: {
      createFolder: vi.fn(async () => mutationResult("Plans")),
      deleteFile: vi.fn(async () => mutationResult("a.txt"))
    },
    batch: {
      executeDeleteTarget: vi.fn(async () => ({ kind: "completed" } as const)),
      acceptDeleteProgress: vi.fn(() => true),
      refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
      isDeleteWorkflowCurrent: vi.fn(() => true)
    },
    selection: {
      clear: vi.fn()
    },
    presentation: {
      setActionError: vi.fn(),
      setStatus: vi.fn(),
      closeMobileDetails: vi.fn(),
      clearFocused: vi.fn()
    },
    labels: {
      toDisplayPath: (path: string) => `/${path}`
    }
  };

  const fixture: MutableFixture = {
    ...defaultPorts,
    ...overrides,
    context: { ...defaultPorts.context, ...overrides.context },
    session: { ...defaultPorts.session, ...overrides.session },
    mutations: { ...defaultPorts.mutations, ...overrides.mutations },
    mutation: { ...defaultPorts.mutation, ...overrides.mutation },
    api: { ...defaultPorts.api, ...overrides.api },
    batch: { ...defaultPorts.batch, ...overrides.batch },
    selection: { ...defaultPorts.selection, ...overrides.selection },
    presentation: { ...defaultPorts.presentation, ...overrides.presentation },
    labels: { ...defaultPorts.labels, ...overrides.labels },
    mutationCalls,
    setContextAllowed(next: boolean) {
      contextAllowed = next;
    }
  };

  fixture.context.isContextAllowed = vi.fn(() => contextAllowed);

  return fixture;
}

describe("runActionDialogSubmitOrchestration", () => {
  it("rejects empty create-folder values without calling mutations", async () => {
    const adapter = ports();
    const context = createOperationContextToken();

    await runActionDialogSubmitOrchestration({
      dialog: { kind: "createFolder", value: "   ", context },
      currentPath: "",
      accountName: "Workspace",
      ...ownership(context)
    }, adapter);

    expect(adapter.presentation.setActionError).toHaveBeenCalledWith("Provide a value before continuing.");
    expect(adapter.mutation.execute).not.toHaveBeenCalled();
    expect(adapter.presentation.setActionError).toHaveBeenCalledTimes(1);
  });

  it("submits create-folder through executeMutation and closes the dialog", async () => {
    const adapter = ports();
    const context = createOperationContextToken();
    const dialog = { kind: "createFolder" as const, value: "Plans", context };

    const owner = ownership(context);
    await runActionDialogSubmitOrchestration({
      dialog,
      currentPath: "",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.mutation.execute).toHaveBeenCalledTimes(1);
    expect(adapter.api.createFolder).toHaveBeenCalledWith("", "Plans");
    expect(owner.completeActionDialog).toHaveBeenCalledWith(owner.attempt, dialog);
  });

  it("submits single delete through executeMutation", async () => {
    const adapter = ports();
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(1, [{ path: "notes.txt", confirmName: "notes.txt" }]);
    const dialog = { kind: "delete" as const, workflow, context };

    const owner = ownership(context);
    await runActionDialogSubmitOrchestration({
      dialog,
      currentPath: "",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.mutation.execute).toHaveBeenCalledTimes(1);
    expect(adapter.api.deleteFile).toHaveBeenCalledWith("notes.txt", "notes.txt");
    expect(adapter.mutations.begin).not.toHaveBeenCalled();
    expect(owner.completeActionDialog).toHaveBeenCalled();
  });

  it("completes batch delete and clears selection on success", async () => {
    const adapter = ports();
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(2, [
      { path: "Projects", confirmName: "Projects" },
      { path: "Projects/roadmap.txt", confirmName: "roadmap.txt" }
    ]);

    const owner = ownership(context);
    await runActionDialogSubmitOrchestration({
      dialog: { kind: "delete", workflow, context },
      currentPath: "",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.mutations.begin).toHaveBeenCalledTimes(1);
    expect(adapter.mutations.finish).toHaveBeenCalledTimes(1);
    expect(adapter.selection.clear).toHaveBeenCalledTimes(1);
    expect(adapter.presentation.setStatus).toHaveBeenCalledWith("Deleted 2 selected items from Workspace.");
    expect(owner.completeActionDialog).toHaveBeenCalled();
  });

  it("retains the dialog and maps confirmation mismatch failures", async () => {
    const adapter = ports({
      batch: {
        executeDeleteTarget: vi.fn(async () => ({ kind: "failed", message: "Delete confirmation does not match selected item" } as const)),
        acceptDeleteProgress: vi.fn(() => true),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
        isDeleteWorkflowCurrent: vi.fn(() => true)
      }
    });
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(3, [
      { path: "a.txt", confirmName: "a.txt" },
      { path: "b.txt", confirmName: "b.txt" }
    ]);

    const owner = ownership(context);
    await runActionDialogSubmitOrchestration({
      dialog: { kind: "delete", workflow, context },
      currentPath: "",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(owner.failAttempt).toHaveBeenCalledWith(owner.attempt, "Name to confirm does not match the selected item.");
    expect(owner.completeActionDialog).not.toHaveBeenCalled();
  });

  it("publishes exact partial facts when a middle target fails after progress", async () => {
    let call = 0;
    const adapter = ports({
      batch: {
        executeDeleteTarget: vi.fn(async () => {
          call += 1;
          return call === 2 ? { kind: "failed", message: "middle failed" } as const : { kind: "completed" } as const;
        }),
        acceptDeleteProgress: vi.fn(() => true),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
        isDeleteWorkflowCurrent: vi.fn(() => true)
      }
    });
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(4, [
      { path: "a.txt", confirmName: "a.txt" },
      { path: "b.txt", confirmName: "b.txt" },
      { path: "c.txt", confirmName: "c.txt" }
    ]);
    const owner = ownership(context);

    await runActionDialogSubmitOrchestration({
      dialog: { kind: "delete", workflow, context }, currentPath: "", accountName: "Workspace", ...owner
    }, adapter);

    expect(owner.failAttempt).not.toHaveBeenCalled();
    expect(owner.reportDeletePartial).toHaveBeenCalledWith(owner.attempt, {
      workflow: { ...workflow, unresolvedTargets: [workflow.submittedTargets[1], workflow.submittedTargets[2]] },
      failedTarget: workflow.submittedTargets[1],
      completedCount: 1,
      totalCount: 3,
      error: "middle failed"
    });
  });

  it("does not report unauthorized submit errors", async () => {
    const adapter = ports({
      mutation: {
        execute: vi.fn(async () => {
          throw new ApiRequestError("token-alpha", 401, "session_invalid");
        })
      }
    });
    const context = createOperationContextToken();

    const owner = ownership(context);
    await runActionDialogSubmitOrchestration({
      dialog: { kind: "createFolder", value: "Plans", context },
      currentPath: "",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.presentation.setActionError).not.toHaveBeenCalled();
    expect(adapter.presentation.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("token-alpha"));
    expect(owner.failAttempt).not.toHaveBeenCalled();
  });
});
