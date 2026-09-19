import type { OperationContextToken } from "../../operations/policy";
import type { BatchSelectionCapture } from "../../operations/selection";
import type { OfflineSyncArchiveInput, OfflineSyncEntrySnapshot, OfflineSyncPlan } from "./model";

export type OfflineSyncDialogPhase = "estimating" | "ready" | "unknown";

export interface OfflineSyncDialogSnapshot {
  readonly context: OperationContextToken;
  readonly entries: readonly OfflineSyncEntrySnapshot[];
  readonly archiveInput: OfflineSyncArchiveInput;
  readonly selectionCapture?: BatchSelectionCapture;
  readonly phase: OfflineSyncDialogPhase;
  readonly plan?: OfflineSyncPlan;
  readonly error?: string;
}

export function snapshotOfflineSyncEntry(entry: OfflineSyncEntrySnapshot): OfflineSyncEntrySnapshot {
  return Object.freeze({
    path: entry.path,
    name: entry.name,
    isFolder: entry.isFolder,
    ...(entry.size === undefined ? {} : { size: entry.size })
  });
}

export function snapshotOfflineSyncArchiveInput(input: OfflineSyncArchiveInput): OfflineSyncArchiveInput {
  return Object.freeze({
    roots: Object.freeze(input.roots.map((root) => Object.freeze({
      entry: snapshotOfflineSyncEntry(root.entry),
      archiveRoot: root.archiveRoot
    }))),
    archiveLabel: input.archiveLabel
  });
}

export function snapshotOfflineSyncSelectionCapture(capture: BatchSelectionCapture): BatchSelectionCapture {
  return Object.freeze({
    ...(capture.accountId === undefined ? {} : { accountId: capture.accountId }),
    memberships: Object.freeze(capture.memberships.map((membership) => Object.freeze({
      identity: Object.freeze({ ...membership.identity }),
      membershipVersion: membership.membershipVersion
    })))
  });
}

export function createEstimatingOfflineSyncDialog(input: {
  readonly context: OperationContextToken;
  readonly entries: readonly OfflineSyncEntrySnapshot[];
  readonly archiveInput: OfflineSyncArchiveInput;
  readonly selectionCapture?: BatchSelectionCapture;
}): OfflineSyncDialogSnapshot {
  return Object.freeze({
    context: input.context,
    entries: Object.freeze(input.entries.map(snapshotOfflineSyncEntry)),
    archiveInput: snapshotOfflineSyncArchiveInput(input.archiveInput),
    ...(input.selectionCapture === undefined ? {} : { selectionCapture: snapshotOfflineSyncSelectionCapture(input.selectionCapture) }),
    phase: "estimating"
  });
}
