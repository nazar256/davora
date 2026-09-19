import { describe, expect, it } from "vitest";

import type { CapabilitySet } from "@davora/shared";

import type { OperationEnvironment } from "./model";
import {
  projectDeleteDialogCanConfirm,
  projectOfflineSyncCanStart,
  projectOperationRenderCapabilities,
  type OperationRenderCapabilities,
  type OperationRenderSelectionState
} from "./projectOperationRenderCapabilities";

const capabilities: CapabilitySet = {
  backend: "nextcloud",
  readOnly: false,
  search: true,
  preview: true,
  download: true,
  offlineCache: false,
  createFolder: true,
  upload: true,
  move: true,
  copy: true,
  delete: true,
  mediaPreview: true,
  markdownPreview: true,
  openedFileCache: true
};

const online: OperationEnvironment = {
  mode: "online",
  hasSession: true,
  capabilities
};

const focusedFileSelection: OperationRenderSelectionState = {
  hasSelectedEntry: true,
  selectedFilePath: "/docs/readme.txt",
  selectedIsFolder: false,
  batchSelectionCount: 0
};

const focusedFolderSelection: OperationRenderSelectionState = {
  hasSelectedEntry: true,
  selectedFilePath: undefined,
  selectedIsFolder: true,
  batchSelectionCount: 0
};

const emptySelection: OperationRenderSelectionState = {
  hasSelectedEntry: false,
  selectedFilePath: undefined,
  selectedIsFolder: false,
  batchSelectionCount: 0
};

const batchSelection: OperationRenderSelectionState = {
  hasSelectedEntry: false,
  selectedFilePath: undefined,
  selectedIsFolder: false,
  batchSelectionCount: 3
};

function project(
  selection: OperationRenderSelectionState,
  destinationSourceCount?: number
) {
  return projectOperationRenderCapabilities({
    environment: online,
    selection,
    destinationSourceCount
  });
}

const operationRenderCapabilityFlags: Array<keyof OperationRenderCapabilities> = [
  "canCreateFolder",
  "canUploadFiles",
  "canUploadFolders",
  "canMoveSelected",
  "canCopySelected",
  "canDeleteSelected",
  "canDownloadSelected",
  "canDownloadBatchSelection",
  "canMarkForBatchDownload",
  "canSyncSelectedOffline",
  "canSyncBatchOffline",
  "canDeleteBatchSelection",
  "canCopyMoveBatchSelection",
  "canSubmitDestinationCopy",
  "canSubmitDestinationMove"
];

describe("projectOperationRenderCapabilities", () => {
  it("matches the current focused and batch shell shapes under a full online session", () => {
    expect(project(focusedFileSelection)).toMatchObject({
      canCreateFolder: true,
      canUploadFiles: true,
      canUploadFolders: true,
      canMoveSelected: true,
      canCopySelected: true,
      canDeleteSelected: true,
      canDownloadSelected: true,
      canDownloadBatchSelection: false,
      canMarkForBatchDownload: true,
      canSyncSelectedOffline: true,
      canSyncBatchOffline: false,
      canDeleteBatchSelection: false,
      canCopyMoveBatchSelection: false,
      canSubmitDestinationCopy: false,
      canSubmitDestinationMove: false
    });

    expect(project(batchSelection)).toMatchObject({
      canMoveSelected: false,
      canCopySelected: false,
      canDeleteSelected: false,
      canDownloadSelected: false,
      canDownloadBatchSelection: true,
      canMarkForBatchDownload: true,
      canSyncSelectedOffline: false,
      canSyncBatchOffline: true,
      canDeleteBatchSelection: true,
      canCopyMoveBatchSelection: true
    });
  });

  it.each([
    ["createFolder", ["canCreateFolder", "canUploadFolders"]],
    ["upload", ["canUploadFiles", "canUploadFolders"]],
    ["move", ["canMoveSelected", "canCopyMoveBatchSelection", "canSubmitDestinationMove"]],
    ["copy", ["canCopySelected", "canCopyMoveBatchSelection", "canSubmitDestinationCopy"]],
    ["delete", ["canDeleteSelected", "canDeleteBatchSelection"]],
    ["download", [
      "canDownloadSelected",
      "canDownloadBatchSelection",
      "canMarkForBatchDownload",
      "canSyncSelectedOffline",
      "canSyncBatchOffline"
    ]]
  ] satisfies Array<[keyof CapabilitySet, readonly (keyof OperationRenderCapabilities)[]]>)(
    "clears only the related can* flags when %s is unavailable",
    (capability, affectedFlags) => {
      const baseline = project(focusedFileSelection, 2);
      const restricted = projectOperationRenderCapabilities({
        environment: {
          ...online,
          capabilities: { ...capabilities, [capability]: false }
        },
        selection: focusedFileSelection,
        destinationSourceCount: 2
      });
      const affected = new Set<keyof OperationRenderCapabilities>(affectedFlags);

      for (const flag of operationRenderCapabilityFlags) {
        if (affected.has(flag)) {
          expect(restricted[flag]).toBe(false);
        } else {
          expect(restricted[flag]).toBe(baseline[flag]);
        }
      }
    }
  );

  it("gates focused selected actions for none, file, and folder selections", () => {
    expect(project(emptySelection)).toMatchObject({
      canMoveSelected: false,
      canCopySelected: false,
      canDeleteSelected: false,
      canDownloadSelected: false,
      canSyncSelectedOffline: false
    });

    expect(project(focusedFileSelection)).toMatchObject({
      canMoveSelected: true,
      canCopySelected: true,
      canDeleteSelected: true,
      canDownloadSelected: true,
      canSyncSelectedOffline: true
    });

    expect(project(focusedFolderSelection)).toMatchObject({
      canMoveSelected: true,
      canCopySelected: true,
      canDeleteSelected: true,
      canDownloadSelected: false,
      canSyncSelectedOffline: true
    });
  });

  it("gates batch actions only when the batch selection is non-empty", () => {
    expect(project(emptySelection)).toMatchObject({
      canDownloadBatchSelection: false,
      canMarkForBatchDownload: true,
      canSyncBatchOffline: false,
      canDeleteBatchSelection: false,
      canCopyMoveBatchSelection: false
    });

    expect(project(batchSelection)).toMatchObject({
      canDownloadBatchSelection: true,
      canMarkForBatchDownload: true,
      canSyncBatchOffline: true,
      canDeleteBatchSelection: true,
      canCopyMoveBatchSelection: true
    });
  });

  it("derives destination submit flags from picker source count policy", () => {
    expect(project(focusedFileSelection)).toMatchObject({
      canSubmitDestinationCopy: false,
      canSubmitDestinationMove: false
    });

    expect(project(focusedFileSelection, 0)).toMatchObject({
      canSubmitDestinationCopy: false,
      canSubmitDestinationMove: false
    });

    expect(project(focusedFileSelection, 2)).toMatchObject({
      canSubmitDestinationCopy: true,
      canSubmitDestinationMove: true
    });
  });

  it("projects the same upload and create-folder flags used by drag/drop and dialog busy UI", () => {
    const flags = project(focusedFileSelection);
    expect(flags.canUploadFiles).toBe(true);
    expect(flags.canCreateFolder).toBe(true);

    const restricted = projectOperationRenderCapabilities({
      environment: {
        ...online,
        capabilities: { ...capabilities, upload: false, createFolder: false }
      },
      selection: focusedFileSelection
    });
    expect(restricted.canUploadFiles).toBe(false);
    expect(restricted.canCreateFolder).toBe(false);
  });
});

describe("dialog capability projections", () => {
  it("derives offline sync start from the dialog entry count", () => {
    expect(projectOfflineSyncCanStart(online, 0)).toBe(false);
    expect(projectOfflineSyncCanStart(online, 2)).toBe(true);
  });

  it("derives delete dialog confirmation from unresolved target count", () => {
    expect(projectDeleteDialogCanConfirm(online, 0)).toBe(false);
    expect(projectDeleteDialogCanConfirm(online, 3)).toBe(true);
  });
});
