import { FolderPlus, FolderUp, Plus, Upload } from "lucide-react";
import { useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent, type RefCallback } from "react";

export interface QuickActionsStageProps {
  readonly open: boolean;
  readonly canUploadFiles: boolean;
  readonly canUploadFolders: boolean;
  readonly canCreateFolder: boolean;
  readonly mutationBusy: boolean;
  readonly onToggle: () => void;
  readonly onDismiss: () => void;
  readonly onUploadFiles: (files: FileList | File[] | null) => void | Promise<void>;
  readonly onUploadFolder: (files: FileList | File[] | null) => void | Promise<void>;
  readonly onCreateFolder: () => void;
  readonly directoryUploadInputRef: RefCallback<HTMLInputElement>;
}

const menuItemSelector = ".quick-actions-item:not(:disabled)";

export function QuickActionsStage(props: QuickActionsStageProps) {
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const menuHadFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (props.open) {
      menuRef.current?.querySelector<HTMLElement>(menuItemSelector)?.focus();
      return;
    }
    if (menuHadFocusRef.current) {
      menuHadFocusRef.current = false;
      fabRef.current?.focus();
    }
  }, [props.open]);

  const handleFileUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void props.onUploadFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleFolderUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void props.onUploadFolder(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const chooseFiles = () => {
    fileInputRef.current?.click();
    props.onDismiss();
  };

  const chooseFolder = () => {
    folderInputRef.current?.click();
    props.onDismiss();
  };

  const createFolder = () => {
    menuHadFocusRef.current = false;
    props.onDismiss();
    props.onCreateFolder();
  };

  const moveFocus = (direction: "next" | "previous" | "first" | "last") => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(menuItemSelector) ?? []);
    if (items.length === 0) {
      return;
    }
    const active = menuRef.current?.ownerDocument.activeElement;
    const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const next = direction === "first"
      ? items[0]
      : direction === "last"
        ? items[items.length - 1]
        : direction === "next"
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length];
    next?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      menuHadFocusRef.current = false;
      fabRef.current?.focus();
      props.onDismiss();
      return;
    }
    const menu = menuRef.current;
    if (!menu?.contains(menu.ownerDocument.activeElement)) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus("next");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus("previous");
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus("first");
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus("last");
    }
  };

  return (
    <div
      className={`quick-actions${props.open ? " open" : ""}`}
      onFocus={(event) => {
        if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
          menuHadFocusRef.current = true;
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {props.open ? (
        <button
          aria-label="Dismiss quick actions"
          className="quick-actions-scrim"
          onClick={props.onDismiss}
          type="button"
        />
      ) : null}
      {props.open ? (
        <div
          aria-label="Quick actions"
          className="quick-actions-menu"
          id="quick-actions-menu"
          ref={menuRef}
          role="menu"
        >
          <button
            className="quick-actions-item"
            disabled={!props.canUploadFiles || props.mutationBusy}
            onClick={chooseFiles}
            role="menuitem"
            type="button"
          >
            <Upload aria-hidden="true" />
            Upload files
          </button>
          <button
            className="quick-actions-item"
            disabled={!props.canUploadFolders || props.mutationBusy}
            onClick={chooseFolder}
            role="menuitem"
            type="button"
          >
            <FolderUp aria-hidden="true" />
            Upload folder
          </button>
          <button
            className="quick-actions-item"
            disabled={!props.canCreateFolder || props.mutationBusy}
            onClick={createFolder}
            role="menuitem"
            type="button"
          >
            <FolderPlus aria-hidden="true" />
            New folder
          </button>
        </div>
      ) : null}
      <button
        aria-controls="quick-actions-menu"
        aria-expanded={props.open}
        aria-haspopup="menu"
        aria-label="Quick actions"
        className="quick-actions-fab"
        onClick={props.onToggle}
        ref={fabRef}
        title="Quick actions"
        type="button"
      >
        <Plus aria-hidden="true" />
      </button>
      <input
        aria-label="Upload files from quick actions"
        className="quick-actions-input"
        multiple
        onChange={handleFileUploadChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        aria-label="Upload folder from quick actions"
        className="quick-actions-input"
        onChange={handleFolderUploadChange}
        ref={(element) => {
          folderInputRef.current = element;
          props.directoryUploadInputRef(element);
        }}
        tabIndex={-1}
        type="file"
      />
    </div>
  );
}
