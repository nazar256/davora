import type { PlannedUploadFile, UploadCandidate, UploadFolderTarget, UploadPlan } from "./model";
import type { UploadExecutionPorts, UploadFileStateEvent } from "./ports";

interface UploadOutcomeFacts<TFile extends UploadCandidate> {
  readonly createdFolders: readonly UploadFolderTarget[];
  readonly completedFiles: readonly PlannedUploadFile<TFile>[];
  readonly createdFolderCount: number;
  readonly completedFileCount: number;
  readonly serverChanged: boolean;
}

export type UploadFailureStage = "createFolder" | "prepareFile" | "uploadFile";

export type UploadExecutionOutcome<TFile extends UploadCandidate = UploadCandidate> =
  | (UploadOutcomeFacts<TFile> & { readonly kind: "completed" })
  | (UploadOutcomeFacts<TFile> & {
      readonly kind: "failed";
      readonly stage: UploadFailureStage;
      readonly failedTargetPath: string;
      readonly message: string;
    })
  | (UploadOutcomeFacts<TFile> & { readonly kind: "sessionTerminated" })
  | (UploadOutcomeFacts<TFile> & { readonly kind: "superseded" });

function facts<TFile extends UploadCandidate>(
  createdFolders: readonly UploadFolderTarget[],
  completedFiles: readonly PlannedUploadFile<TFile>[]
): UploadOutcomeFacts<TFile> {
  return {
    createdFolders: [...createdFolders],
    completedFiles: [...completedFiles],
    createdFolderCount: createdFolders.length,
    completedFileCount: completedFiles.length,
    serverChanged: createdFolders.length > 0 || completedFiles.length > 0
  };
}

export async function executeUpload<TFile extends UploadCandidate>(
  plan: UploadPlan<TFile>,
  ports: UploadExecutionPorts<TFile>
): Promise<UploadExecutionOutcome<TFile>> {
  const createdFolders: UploadFolderTarget[] = [];
  const completedFiles: PlannedUploadFile<TFile>[] = [];
  const isOwned = () => !ports.signal.aborted && ports.isCurrent();
  const superseded = () => ({ kind: "superseded" as const, ...facts(createdFolders, completedFiles) });
  const terminated = () => ({ kind: "sessionTerminated" as const, ...facts(createdFolders, completedFiles) });
  const publish = (event: UploadFileStateEvent<TFile>) => isOwned() && ports.publishFileState(event) && isOwned();
  const refreshAfterFailure = async () => {
    if (createdFolders.length === 0 && completedFiles.length === 0) {
      return undefined;
    }
    if (!isOwned()) {
      return superseded();
    }
    const refresh = await ports.refreshFolder();
    if (!isOwned()) {
      return superseded();
    }
    return refresh.kind === "sessionTerminated" ? terminated() : undefined;
  };
  const failed = async (stage: UploadFailureStage, failedTargetPath: string, message: string) => {
    const refreshOutcome = await refreshAfterFailure();
    return refreshOutcome ?? { kind: "failed" as const, stage, failedTargetPath, message, ...facts(createdFolders, completedFiles) };
  };

  if (!isOwned()) {
    return superseded();
  }

  for (const folder of plan.folders) {
    if (!isOwned()) {
      return superseded();
    }
    const result = await ports.createFolder(folder);
    if (!isOwned()) {
      return superseded();
    }
    if (result.kind === "sessionTerminated") {
      return terminated();
    }
    if (result.kind === "failed") {
      return failed("createFolder", folder.path, result.message);
    }
    if (result.kind === "created") {
      createdFolders.push(folder);
    }
  }

  for (const file of plan.files) {
    if (!isOwned() || !publish({ kind: "preparing", file })) {
      return superseded();
    }
    const prepared = await ports.prepareFile(
      file,
      (loadedBytes, totalBytes) => publish({ kind: "preparationProgress", file, loadedBytes, totalBytes }),
      ports.signal
    );
    if (!isOwned()) {
      return superseded();
    }
    if (prepared.kind === "failed") {
      return failed("prepareFile", file.destinationPath, prepared.message);
    }
    if (!publish({ kind: "transferring", file })) {
      return superseded();
    }
    const uploaded = await ports.uploadFile(
      file,
      prepared.contentBase64,
      (loadedBytes, totalBytes) => publish({ kind: "uploadProgress", file, loadedBytes, totalBytes }),
      ports.signal
    );
    if (!isOwned()) {
      return superseded();
    }
    if (uploaded.kind === "sessionTerminated") {
      return terminated();
    }
    if (uploaded.kind === "failed") {
      return failed("uploadFile", file.destinationPath, uploaded.message);
    }
    if (!publish({ kind: "completed", file })) {
      return superseded();
    }
    completedFiles.push(file);
  }

  if (!isOwned()) {
    return superseded();
  }
  const refresh = await ports.refreshFolder();
  if (!isOwned()) {
    return superseded();
  }
  return refresh.kind === "sessionTerminated"
    ? terminated()
    : { kind: "completed", ...facts(createdFolders, completedFiles) };
}
