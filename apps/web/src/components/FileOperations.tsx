import type { ChangeEvent } from "react";

import type { FileEntry } from "@davora/shared";

export interface FileOperationsProps {
  currentPath: string;
  canMutate: boolean;
  mutationBusy: boolean;
  selectedEntry?: FileEntry;
  onCreateFolder: () => void;
  onUpload: (files: FileList | File[] | null) => void;
  onMoveSelected: () => void;
  onCopySelected: () => void;
  onDeleteSelected: () => void;
}

function applyDirectoryUploadAttributes(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }

  input.multiple = true;
  input.setAttribute("multiple", "");
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).webkitdirectory = true;
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).directory = true;
}

export function FileOperations(props: FileOperationsProps) {
  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    props.onUpload(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  return (
    <section className="operations panel">
      <div className="operations-header">
        <div>
          <p className="eyebrow section-eyebrow">Actions</p>
          <h2>Workspace actions</h2>
          <p className="status">Current folder: {props.currentPath || "/"}</p>
        </div>
        <span className={`operation-pill ${props.canMutate ? "enabled" : "disabled"}`}>{props.canMutate ? "Online mutations enabled" : "Offline mutations disabled"}</span>
      </div>

      <div className="action-groups">
        <div className="action-group">
          <span className="action-group-label">New in this folder</span>
          <div className="action-row">
            <button disabled={!props.canMutate || props.mutationBusy} onClick={props.onCreateFolder}>Create folder</button>
            <label className={`upload-label ${!props.canMutate || props.mutationBusy ? "disabled" : ""}`}>
              Upload files
              <input aria-label="Upload files" disabled={!props.canMutate || props.mutationBusy} multiple onChange={onFileInput} type="file" />
            </label>
            <label className={`upload-label ${!props.canMutate || props.mutationBusy ? "disabled" : ""}`}>
              Upload folder
              <input aria-label="Upload folder" disabled={!props.canMutate || props.mutationBusy} onChange={onFileInput} ref={applyDirectoryUploadAttributes} type="file" />
            </label>
          </div>
        </div>

        <div className="action-group">
          <span className="action-group-label">Selected item</span>
          <p className="status">{props.selectedEntry ? `Selected: ${props.selectedEntry.path}` : "Open any file or folder to keep actions contextual instead of permanently expanded."}</p>
          <div className="action-row">
            <button disabled={!props.canMutate || props.mutationBusy || !props.selectedEntry} onClick={props.onMoveSelected}>Rename or move selected</button>
            <button disabled={!props.canMutate || props.mutationBusy || !props.selectedEntry} onClick={props.onCopySelected}>Copy selected</button>
            <button disabled={!props.canMutate || props.mutationBusy || !props.selectedEntry} onClick={props.onDeleteSelected}>Delete selected</button>
          </div>
        </div>
      </div>
    </section>
  );
}
