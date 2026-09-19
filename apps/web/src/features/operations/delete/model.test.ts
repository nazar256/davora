import { describe, expect, it } from "vitest";

import { createOperationContextToken } from "../policy";
import {
  acceptDeleteProgress,
  buildBatchDeleteSuccessStatus,
  buildCreateFolderActionDialogState,
  buildDeleteActionDialogState,
  CREATE_FOLDER_EMPTY_VALUE_ERROR,
  createBatchDeleteWorkflow,
  DELETE_CONFIRM_MISMATCH_ERROR,
  isDeleteConfirmationMismatch,
  mapActionDialogSubmitError,
  mapDeleteActionError,
  planDeleteExecution,
  shouldReportActionDialogSubmitError,
  validateCreateFolderSubmitValue,
  type DeleteTarget
} from "./model";

const target = (path: string): DeleteTarget => ({ path, confirmName: path.split("/").at(-1) ?? path });

describe("batch delete workflow model", () => {
  it("plans descendants before ancestors while preserving original equal-depth order", () => {
    const workflow = createBatchDeleteWorkflow(7, [
      target("Docs"),
      target("Peer/a.txt"),
      target("Docs/Sub/b.txt"),
      target("Docs/a.txt"),
      target("Peer")
    ]);

    expect(planDeleteExecution(workflow).map((item) => item.path)).toEqual([
      "Docs/Sub/b.txt",
      "Peer/a.txt",
      "Docs/a.txt",
      "Docs",
      "Peer"
    ]);
  });

  it("treats prefix siblings as unrelated and keeps their input order", () => {
    const workflow = createBatchDeleteWorkflow(8, [target("Docs-old/a.txt"), target("Docs/a.txt")]);

    expect(planDeleteExecution(workflow).map((item) => item.path)).toEqual(["Docs-old/a.txt", "Docs/a.txt"]);
  });

  it("removes accepted progress from the unresolved queue without mutating input", () => {
    const workflow = createBatchDeleteWorkflow(9, [target("Docs"), target("Docs/a.txt"), target("Peer")]);

    const next = acceptDeleteProgress(workflow, target("Docs/a.txt"));

    expect(next.unresolvedTargets.map((item) => item.path)).toEqual(["Docs", "Peer"]);
    expect(workflow.unresolvedTargets.map((item) => item.path)).toEqual(["Docs", "Docs/a.txt", "Peer"]);
  });

  it.each([
    [0, [target("a.txt")]],
    [1, []],
    [1, [target("../a.txt")]],
    [1, [target("Docs/")]],
    [1, [target("a.txt"), target("a.txt")]]
  ])("rejects invalid workflow identity or targets", (identity, targets) => {
    expect(() => createBatchDeleteWorkflow(identity, targets)).toThrow();
  });

  it("builds create-folder and delete dialog snapshots", () => {
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(3, [target("a.txt")]);

    expect(buildCreateFolderActionDialogState(context)).toEqual({
      kind: "createFolder",
      value: "New folder",
      context
    });
    expect(buildDeleteActionDialogState(context, workflow)).toEqual({
      kind: "delete",
      workflow,
      context
    });
  });

  it("validates create-folder submit values", () => {
    expect(validateCreateFolderSubmitValue("Plans")).toEqual({ kind: "valid" });
    expect(validateCreateFolderSubmitValue("  ")).toEqual({
      kind: "invalid",
      message: CREATE_FOLDER_EMPTY_VALUE_ERROR
    });
  });

  it("maps delete confirmation mismatch errors", () => {
    expect(isDeleteConfirmationMismatch("Delete confirmation does not match selected item")).toBe(true);
    expect(mapDeleteActionError("Delete confirmation does not match selected item")).toBe(DELETE_CONFIRM_MISMATCH_ERROR);
    expect(mapDeleteActionError("Folder delete failed")).toBe("Folder delete failed");
    expect(mapActionDialogSubmitError(
      buildDeleteActionDialogState(createOperationContextToken(), createBatchDeleteWorkflow(4, [target("a.txt")])),
      new Error("Delete confirmation does not match selected item")
    )).toBe(DELETE_CONFIRM_MISMATCH_ERROR);
  });

  it("builds batch delete success status messages", () => {
    const toDisplayPath = (path: string) => `/${path}`;
    expect(buildBatchDeleteSuccessStatus(2, "Workspace", undefined, toDisplayPath))
      .toBe("Deleted 2 selected items from Workspace.");
    expect(buildBatchDeleteSuccessStatus(1, "Workspace", "Projects", toDisplayPath))
      .toBe("delete completed for /Projects in Workspace");
  });

  it("reports action-dialog submit errors only when still current", () => {
    expect(shouldReportActionDialogSubmitError(true, true, false)).toBe(true);
    expect(shouldReportActionDialogSubmitError(false, true, false)).toBe(false);
    expect(shouldReportActionDialogSubmitError(true, false, false)).toBe(false);
    expect(shouldReportActionDialogSubmitError(true, true, true)).toBe(false);
  });
});
