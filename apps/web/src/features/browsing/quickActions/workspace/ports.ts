import type { ConnectedAccount } from "@davora/shared";

import type { QuickActionsStageProps } from "../QuickActionsStage";

export interface QuickActionsWorkspaceInput {
  readonly owners: {
    readonly account: {
      readonly operationalActiveAccount?: ConnectedAccount;
      readonly totalAccountCount: number;
    };
    readonly navigation: {
      readonly quickActionsOpen: boolean;
      openChrome(surface: "quick-actions"): void;
      closeChrome(surface: "quick-actions"): void;
    };
    readonly operation: {
      readonly capabilities: {
        readonly canCreateFolder: boolean;
        readonly canUploadFiles: boolean;
        readonly canUploadFolders: boolean;
      };
      readonly mutation: { readonly state: { readonly busy: boolean } };
      readonly commands: { openCreateFolder(): void };
      readonly upload: { uploadFiles(files: FileList | File[] | null): Promise<void> };
    };
    readonly viewport: { readonly isNarrowScreen: boolean };
    /** Competing surfaces that force the control to hide or close. */
    readonly surfaces: {
      readonly navigationDrawerOpen: boolean;
      readonly mobileSearchOpen: boolean;
      readonly mobileDetailsOpen: boolean;
      readonly settingsOpen: boolean;
      readonly transfersOpen: boolean;
      readonly mutationSurfaceOpen: boolean;
      readonly previewOpen: boolean;
      readonly accountSurfaceOpen: boolean;
      readonly offlineSyncOpen: boolean;
      readonly selectionModeActive: boolean;
    };
  };
  readonly ports: {
    readonly directoryUploadInputRef: QuickActionsStageProps["directoryUploadInputRef"];
  };
}

export interface QuickActionsWorkspaceOutput {
  readonly binding?: { readonly props: QuickActionsStageProps };
}
