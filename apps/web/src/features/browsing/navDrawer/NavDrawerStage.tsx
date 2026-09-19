import { Folder, FolderPlus, FolderUp, House, Settings, Upload, Wifi, WifiOff, X } from "lucide-react";
import { useLayoutEffect, useRef, type ChangeEvent, type RefCallback } from "react";

import { FavouritesStage, type FavouritesStageProps } from "../favourites";
import type { BreadcrumbItem } from "../presentation";

function buildNavigationDrawerStatusLabel(input: {
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
}): string {
  if (input.explicitOfflineMode) {
    return "Offline mode";
  }
  if (input.offline) {
    return "Offline";
  }
  if (input.workerUnavailable) {
    return "Unavailable";
  }
  return "Online";
}

export interface NavDrawerStageProps
  extends Pick<FavouritesStageProps, "entries" | "offlineMode" | "pointerEnvironment" | "onOpen" | "onRemove" | "onReorder"> {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly accountName: string;
  readonly locationLabel: string;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
  readonly explicitOfflineMode: boolean;
  readonly cacheOnlyMode: boolean;
  readonly onToggleOffline: () => void;
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly currentPath: string;
  readonly onNavigateToPath: (path: string) => void;
  readonly canCreateFolder: boolean;
  readonly canUploadFiles: boolean;
  readonly canUploadFolders: boolean;
  readonly mutationBusy: boolean;
  readonly onCreateFolder: () => void;
  readonly onUploadFiles: (files: FileList | File[] | null) => void | Promise<void>;
  readonly onUploadFolder: (files: FileList | File[] | null) => void | Promise<void>;
  readonly onOpenSettings: () => void;
  readonly directoryUploadInputRef: RefCallback<HTMLInputElement>;
}

export function NavDrawerStage(props: NavDrawerStageProps) {
  const asideRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (asideRef.current) {
      asideRef.current.inert = !props.open;
    }
  }, [props.open]);

  const statusBadgeLabel = buildNavigationDrawerStatusLabel({
    explicitOfflineMode: props.explicitOfflineMode,
    offline: props.offline,
    workerUnavailable: props.workerUnavailable
  });

  const handleFileUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void props.onUploadFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleFolderUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void props.onUploadFolder(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  return (
    <>
      {props.open ? (
        <button
          aria-label="Close navigation menu"
          className="nav-drawer-scrim open"
          onClick={props.onClose}
          type="button"
        />
      ) : null}
      <aside
        aria-hidden={!props.open}
        aria-label="Navigation menu"
        className={`nav-drawer${props.open ? " open" : ""}`}
        ref={asideRef}
      >
        <div className="nav-drawer-header">
          <div>
            <p className="eyebrow section-eyebrow">Workspace</p>
            <h2>{props.accountName}</h2>
            <p className="status">{props.locationLabel}</p>
          </div>
          <button
            aria-label="Close navigation menu"
            className="quiet-button icon-button"
            onClick={props.onClose}
            title="Close navigation menu"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="nav-drawer-status">
          <span className={`badge status-badge ${props.cacheOnlyMode ? "offline" : "online"}`}>
            {props.cacheOnlyMode ? <WifiOff aria-hidden="true" /> : <Wifi aria-hidden="true" />}
            {statusBadgeLabel}
          </span>
          <span className={`operation-pill ${props.cacheOnlyMode ? "disabled" : "enabled"}`}>
            {props.cacheOnlyMode ? "Read-only" : "Ready"}
          </span>
        </div>
        <div className="nav-drawer-section">
          <button className="button-with-icon drawer-offline-toggle" onClick={props.onToggleOffline} type="button">
            {props.explicitOfflineMode ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
            {props.explicitOfflineMode ? "Go online" : "Go offline"}
          </button>
          <p className="nav-drawer-empty">
            {props.explicitOfflineMode
              ? "Browsing readable files stored on this device only."
              : "Switch to cached-only browsing without contacting the server."}
          </p>
        </div>
        <FavouritesStage
          key={props.open ? "open" : "closed"}
          entries={props.entries}
          offlineMode={props.offlineMode}
          pointerEnvironment={props.pointerEnvironment}
          onOpen={props.onOpen}
          onRemove={props.onRemove}
          onReorder={props.onReorder}
        />
        <nav aria-label="Folder navigation" className="nav-drawer-section">
          <p className="summary-label">Folders</p>
          {props.breadcrumbs.map((item) => (
            <button
              aria-current={item.value === props.currentPath ? "page" : undefined}
              className={item.value === props.currentPath ? "active" : undefined}
              key={item.value || "root"}
              onClick={() => props.onNavigateToPath(item.value)}
              type="button"
            >
              {item.value ? <Folder aria-hidden="true" /> : <House aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="nav-drawer-section">
          <p className="summary-label">Actions</p>
          <button
            className="button-with-icon"
            disabled={!props.canCreateFolder || props.mutationBusy}
            onClick={props.onCreateFolder}
            type="button"
          >
            <FolderPlus aria-hidden="true" />
            Create folder
          </button>
          <label className={`nav-drawer-upload ${!props.canUploadFiles || props.mutationBusy ? "disabled" : ""}`}>
            <Upload aria-hidden="true" />
            Upload files
            <input
              aria-label="Upload files from navigation menu"
              disabled={!props.canUploadFiles || props.mutationBusy}
              multiple
              onChange={handleFileUploadChange}
              type="file"
            />
          </label>
          <label className={`nav-drawer-upload ${!props.canUploadFolders || props.mutationBusy ? "disabled" : ""}`}>
            <FolderUp aria-hidden="true" />
            Upload folder
            <input
              aria-label="Upload folder from navigation menu"
              disabled={!props.canUploadFolders || props.mutationBusy}
              onChange={handleFolderUploadChange}
              ref={props.directoryUploadInputRef}
              type="file"
            />
          </label>
          <button onClick={props.onOpenSettings} type="button">
            <Settings aria-hidden="true" />
            Profile & settings
          </button>
        </div>
      </aside>
    </>
  );
}
