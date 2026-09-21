import { useMemo } from "react";

import { dirname, type ConnectedAccount } from "@davora/shared";

import type { AccountBootstrapGate } from "../../../accounts";
import type { AppBarStageProps } from "../stage";
import { useAppBarSortPanel } from "../sortPanel";
import type { FolderSortController } from "../../folderSort";
import type { PwaInstallBinding } from "../../../pwa";
import { TransferTrayStage, type TransferTask, useTransferTray } from "../../../transfers";

export interface AppBarWorkspaceOwners {
  readonly account: {
    readonly operationalActiveAccount?: ConnectedAccount;
    readonly totalAccountCount: number;
  };
  readonly session: { readonly token?: string };
  readonly bootstrap: {
    readonly gate: AccountBootstrapGate;
    readonly appBarSupportText: string;
    readonly cacheOnlyMode: boolean;
    readonly workerUnavailable: boolean;
  };
  readonly connectivity: { readonly offline: boolean };
  readonly viewport: { readonly isNarrowScreen: boolean };
  readonly browsing: {
    readonly query: { readonly raw: string; readonly set: (value: string) => void };
    readonly presentation: {
      readonly folderLabel: string;
      readonly locationLabel: string;
      readonly showRoutineCachedRefresh: boolean;
    };
    readonly sort: FolderSortController;
  };
  readonly navigation: {
    readonly currentPath: string;
    readonly navigationDrawerOpen: boolean;
    readonly mobileSearchOpen: boolean;
    readonly transferOpen: boolean;
    readonly openChrome: (surface: "navigation" | "search" | "settings" | "transfers") => void;
    readonly closeChrome: (surface: "search" | "transfers") => void;
    readonly navigateToPath: (path: string) => void;
  };
  readonly offline: { readonly explicitOfflineMode: boolean };
  readonly pwa: { readonly install: PwaInstallBinding };
  readonly wakeLock: { readonly active: boolean; readonly reasonLabel: string };
  readonly transfers: {
    readonly tasks: readonly TransferTask[];
    readonly clearAccountHistory: (accountId: string) => void;
  };
  readonly offlineSync: { readonly commands: { readonly retry: (task: TransferTask) => void | Promise<void> } };
  readonly operation: {
    readonly cancelTransferTask: (taskId: string) => void;
    readonly retryTransferTask: (taskId: string) => void;
  };
}

export interface AppBarWorkspaceInput {
  readonly owners: AppBarWorkspaceOwners;
}

export interface AppBarWorkspaceOutput {
  readonly binding: AppBarStageProps;
}

export function useAppBarWorkspace({ owners }: AppBarWorkspaceInput): AppBarWorkspaceOutput {
  const sortPanel = useAppBarSortPanel({ sort: owners.browsing.sort });
  const transferTray = useTransferTray({
    ports: useMemo(() => ({
      chrome: {
        isOpen: owners.navigation.transferOpen,
        open: () => owners.navigation.openChrome("transfers"),
        close: () => owners.navigation.closeChrome("transfers")
      },
      transfers: {
        tasks: owners.transfers.tasks,
        clearAccountHistory: owners.transfers.clearAccountHistory
      },
      accountId: owners.account.operationalActiveAccount?.id,
      onRetryFailedSync: owners.offlineSync.commands.retry,
      onCancelTransfer: (task: TransferTask) => owners.operation.cancelTransferTask(task.id),
      onRetryTransfer: (task: TransferTask) => owners.operation.retryTransferTask(task.id)
    }), [
      owners.account.operationalActiveAccount?.id,
      owners.navigation,
      owners.offlineSync.commands.retry,
      owners.operation,
      owners.transfers
    ])
  });

  const binding = useMemo((): AppBarStageProps => {
    const hasAccounts = owners.account.totalAccountCount > 0;
    const compactMobileHeader = owners.viewport.isNarrowScreen && hasAccounts;
    return {
      cacheOnlyMode: owners.bootstrap.cacheOnlyMode,
      compactMobileHeader,
      currentFolderLabel: owners.browsing.presentation.folderLabel,
      currentPath: owners.navigation.currentPath,
      explicitOfflineMode: owners.offline.explicitOfflineMode,
      hasAccounts,
      hasSession: Boolean(owners.session.token),
      install: owners.pwa.install,
      mobileSearchOpen: owners.navigation.mobileSearchOpen,
      navigationDrawerOpen: owners.navigation.navigationDrawerOpen,
      offline: owners.connectivity.offline,
      onCloseMobileSearch: () => owners.navigation.closeChrome("search"),
      onNavigateUp: () => owners.navigation.navigateToPath(dirname(owners.navigation.currentPath)),
      onOpenMobileSearch: () => owners.navigation.openChrome("search"),
      onOpenNavigationDrawer: () => owners.navigation.openChrome("navigation"),
      onOpenSettings: () => owners.navigation.openChrome("settings"),
      onSearchQueryChange: owners.browsing.query.set,
      screenWakeLockActive: owners.wakeLock.active,
      screenWakeLockReasonLabel: owners.wakeLock.reasonLabel,
      searchQuery: owners.browsing.query.raw,
      showRoutineCachedRefresh: owners.browsing.presentation.showRoutineCachedRefresh,
      sortMode: owners.browsing.sort.mode,
      sortPanel,
      supportText: owners.bootstrap.gate.kind === "continue"
        ? owners.browsing.presentation.locationLabel
        : owners.bootstrap.appBarSupportText,
      transferTray: hasAccounts ? <TransferTrayStage {...transferTray.stage} /> : undefined,
      workerUnavailable: owners.bootstrap.workerUnavailable
    };
  }, [owners, sortPanel, transferTray.stage]);

  return { binding };
}
