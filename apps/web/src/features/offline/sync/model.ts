export type OfflineSyncRootKind = "file" | "folder" | "batch";

export interface OfflineSyncEntrySnapshot {
  readonly path: string;
  readonly name: string;
  readonly isFolder: boolean;
  readonly size?: number;
}

export interface OfflineSyncArchiveRoot {
  readonly entry: OfflineSyncEntrySnapshot;
  readonly archiveRoot: string;
}

export interface OfflineSyncArchiveInput {
  readonly roots: readonly OfflineSyncArchiveRoot[];
  readonly archiveLabel: string;
}

export interface OfflineSyncPlannedFile {
  readonly sourcePath: string;
  readonly size?: number;
}

export interface OfflineSyncPlan {
  readonly files: readonly OfflineSyncPlannedFile[];
  readonly totalBytes?: number;
}

export type OfflineSyncPlanSource =
  | { readonly kind: "acceptedPlan"; readonly plan: OfflineSyncPlan }
  | { readonly kind: "resolvePlan"; readonly archiveInput: OfflineSyncArchiveInput };

export interface OfflineSyncJob {
  readonly id: string;
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly root: {
    readonly path: string;
    readonly name: string;
    readonly kind: OfflineSyncRootKind;
    readonly folderRoots: readonly string[];
  };
  readonly selectedEntries: readonly OfflineSyncEntrySnapshot[];
  readonly planSource: OfflineSyncPlanSource;
}

export type OfflineSyncJobInput = OfflineSyncJob;

function snapshotEntry(entry: OfflineSyncEntrySnapshot): OfflineSyncEntrySnapshot {
  return Object.freeze({
    path: entry.path,
    name: entry.name,
    isFolder: entry.isFolder,
    ...(entry.size === undefined ? {} : { size: entry.size })
  });
}

function snapshotPlan(plan: OfflineSyncPlan): OfflineSyncPlan {
  return Object.freeze({
    files: Object.freeze(plan.files.map((file) => Object.freeze({
      sourcePath: file.sourcePath,
      ...(file.size === undefined ? {} : { size: file.size })
    }))),
    ...(plan.totalBytes === undefined ? {} : { totalBytes: plan.totalBytes })
  });
}

export function createOfflineSyncJob(input: OfflineSyncJobInput): OfflineSyncJob {
  const planSource: OfflineSyncPlanSource = input.planSource.kind === "acceptedPlan"
    ? Object.freeze({ kind: "acceptedPlan", plan: snapshotPlan(input.planSource.plan) })
    : Object.freeze({
        kind: "resolvePlan",
        archiveInput: Object.freeze({
          roots: Object.freeze(input.planSource.archiveInput.roots.map((root) => Object.freeze({
            entry: snapshotEntry(root.entry),
            archiveRoot: root.archiveRoot
          }))),
          archiveLabel: input.planSource.archiveInput.archiveLabel
        })
      });

  return Object.freeze({
    id: input.id,
    accountId: input.accountId,
    cacheNamespace: input.cacheNamespace,
    root: Object.freeze({
      path: input.root.path,
      name: input.root.name,
      kind: input.root.kind,
      folderRoots: Object.freeze([...input.root.folderRoots])
    }),
    selectedEntries: Object.freeze(input.selectedEntries.map(snapshotEntry)),
    planSource
  });
}
