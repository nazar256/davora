import { useCallback, useEffect } from "react";

import type { QuickActionsWorkspaceInput, QuickActionsWorkspaceOutput } from "./ports";

/**
 * Owns the floating quick-action surface state for the file browser. Open state
 * lives in the navigation chrome surface registry so Android/system Back and
 * pull-to-refresh eligibility resolve through the shared surface coordinator.
 */
export function useQuickActionsWorkspace(
  input: QuickActionsWorkspaceInput
): QuickActionsWorkspaceOutput {
  const { account, navigation, operation, surfaces, viewport } = input.owners;
  const { directoryUploadInputRef } = input.ports;

  const anyActionAvailable = operation.capabilities.canCreateFolder
    || operation.capabilities.canUploadFiles
    || operation.capabilities.canUploadFolders;
  const surfaceBusy = surfaces.navigationDrawerOpen
    || surfaces.mobileSearchOpen
    || surfaces.mobileDetailsOpen
    || surfaces.settingsOpen
    || surfaces.transfersOpen
    || surfaces.mutationSurfaceOpen
    || surfaces.previewOpen
    || surfaces.accountSurfaceOpen
    || surfaces.offlineSyncOpen
    || surfaces.selectionModeActive;
  const visible = viewport.isNarrowScreen
    && account.totalAccountCount > 0
    && Boolean(account.operationalActiveAccount)
    && anyActionAvailable
    && !surfaceBusy;

  const { closeChrome, openChrome, quickActionsOpen } = navigation;
  useEffect(() => {
    if (quickActionsOpen && !visible) {
      closeChrome("quick-actions");
    }
  }, [closeChrome, quickActionsOpen, visible]);

  const onToggle = useCallback(() => {
    if (quickActionsOpen) {
      closeChrome("quick-actions");
    } else {
      openChrome("quick-actions");
    }
  }, [closeChrome, openChrome, quickActionsOpen]);
  const onDismiss = useCallback(() => {
    closeChrome("quick-actions");
  }, [closeChrome]);
  const onCreateFolder = useCallback(() => {
    closeChrome("quick-actions");
    operation.commands.openCreateFolder();
  }, [closeChrome, operation.commands]);
  const onUploadFiles = useCallback((files: FileList | File[] | null) => {
    closeChrome("quick-actions");
    return operation.upload.uploadFiles(files);
  }, [closeChrome, operation.upload]);
  const onUploadFolder = useCallback((files: FileList | File[] | null) => {
    closeChrome("quick-actions");
    return operation.upload.uploadFiles(files);
  }, [closeChrome, operation.upload]);

  const binding = visible
    ? {
      props: {
        canCreateFolder: operation.capabilities.canCreateFolder,
        canUploadFiles: operation.capabilities.canUploadFiles,
        canUploadFolders: operation.capabilities.canUploadFolders,
        directoryUploadInputRef,
        mutationBusy: operation.mutation.state.busy,
        onCreateFolder,
        onDismiss,
        onToggle,
        onUploadFiles,
        onUploadFolder,
        open: quickActionsOpen
      }
    }
    : undefined;

  return { binding };
}
