import type { ComponentProps, ComponentPropsWithRef, Key } from "react";

import {
  AppBarStage,
  BrowseHeaderStage,
  FileListStage,
  NavDrawerStage,
  QuickActionsStage
} from "../features/browsing";
import {
  AccountBootstrapShell,
  ConnectAccountDialogStage,
  RemoveAccountStage
} from "../features/accounts";
import {
  SettingsDialogStage
} from "../features/settings";
import { FolderShortcutStage } from "../features/folderShortcut";
import { OfflineSyncConfirmStage } from "../features/offline/sync";
import {
  MutationWorkflowStage,
  SelectionDetailsStage
} from "../features/operations";
import {
  PullToRefreshIndicatorStage,
  type PullToRefreshShellBinding
} from "../features/navigation/pullToRefresh";
import { FolderAudioBrowseMount } from "../features/preview/folderAudio";
import { PreviewModalStage } from "../features/preview/shell";
import { ReloadPromptStage } from "../features/pwa";
import { WorkspaceStatusStage } from "../features/workspace/status";

type NavigationDrawerBinding = {
  readonly key?: Key;
  readonly props: ComponentProps<typeof NavDrawerStage>;
};

export interface AppShellCommonBindings {
  readonly reloadPrompt: ComponentProps<typeof ReloadPromptStage>;
  readonly appBar: ComponentProps<typeof AppBarStage>;
  readonly navigationDrawer?: NavigationDrawerBinding;
  readonly removeAccount: ComponentProps<typeof RemoveAccountStage>;
  readonly settings?: ComponentProps<typeof SettingsDialogStage>;
}

type BootstrapBindings = Omit<
  ComponentProps<typeof AccountBootstrapShell>,
  "appBar" | "navDrawer" | "reloadPrompt"
>;

type WorkspaceStatusBindings = ComponentProps<typeof WorkspaceStatusStage>;

interface WorkspaceBindings {
  readonly className: string;
  readonly pullToRefresh: PullToRefreshShellBinding;
  readonly browsePanelClassName: string;
  readonly browseHeader: ComponentProps<typeof BrowseHeaderStage>;
  readonly folderAudio: ComponentProps<typeof FolderAudioBrowseMount>;
  readonly fileList: {
    readonly props: ComponentProps<typeof FileListStage>;
    readonly ref?: ComponentPropsWithRef<typeof FileListStage>["ref"];
  };
  readonly selectionDetails: ComponentProps<typeof SelectionDetailsStage>;
  readonly quickActions?: ComponentProps<typeof QuickActionsStage>;
}

interface WorkspaceOverlayBindings {
  readonly settings: ComponentProps<typeof SettingsDialogStage>;
  readonly folderShortcut: ComponentProps<typeof FolderShortcutStage>;
  readonly offlineSync: ComponentProps<typeof OfflineSyncConfirmStage>;
  readonly connectAccount: ComponentProps<typeof ConnectAccountDialogStage>;
  readonly mutation: ComponentProps<typeof MutationWorkflowStage>;
  readonly preview: ComponentProps<typeof PreviewModalStage>;
}

export type AppShellProps =
  | {
      readonly kind: "bootstrap";
      readonly common: AppShellCommonBindings;
      readonly bootstrap: BootstrapBindings;
    }
  | {
      readonly kind: "workspace";
      readonly common: AppShellCommonBindings;
      readonly status: WorkspaceStatusBindings;
      readonly workspace: WorkspaceBindings;
      readonly overlays: WorkspaceOverlayBindings;
    };

function renderNavigationDrawer(binding: NavigationDrawerBinding | undefined) {
  return binding
    ? <NavDrawerStage key={binding.key} {...binding.props} />
    : undefined;
}

function renderAppBar(common: AppShellCommonBindings) {
  return <AppBarStage {...common.appBar} />;
}

function renderReloadPrompt(common: AppShellCommonBindings) {
  return <ReloadPromptStage {...common.reloadPrompt} />;
}

export function AppShell(props: AppShellProps) {
  const { common } = props;

  if (props.kind === "bootstrap") {
    return (
      <>
        <AccountBootstrapShell
          {...props.bootstrap}
          appBar={renderAppBar(common)}
          navDrawer={renderNavigationDrawer(common.navigationDrawer)}
          reloadPrompt={renderReloadPrompt(common)}
        />
        {common.settings ? <SettingsDialogStage {...common.settings} /> : null}
        <RemoveAccountStage {...common.removeAccount} />
      </>
    );
  }

  const { overlays, status, workspace } = props;
  const { pullToRefresh } = workspace;

  return (
    <div className="shell">
      {renderReloadPrompt(common)}
      {renderAppBar(common)}
      {renderNavigationDrawer(common.navigationDrawer)}
      <WorkspaceStatusStage {...status} />

      <main className={workspace.className} {...pullToRefresh.handlers}>
        <PullToRefreshIndicatorStage {...pullToRefresh.indicator} />
        <section className={workspace.browsePanelClassName}>
          <BrowseHeaderStage {...workspace.browseHeader} />
          <FolderAudioBrowseMount {...workspace.folderAudio} />
          <FileListStage {...workspace.fileList.props} ref={workspace.fileList.ref} />
        </section>
        {workspace.quickActions ? <QuickActionsStage {...workspace.quickActions} /> : null}
        <SelectionDetailsStage {...workspace.selectionDetails} />
      </main>

      <SettingsDialogStage {...overlays.settings} />
      <FolderShortcutStage {...overlays.folderShortcut} />
      <OfflineSyncConfirmStage {...overlays.offlineSync} />
      <ConnectAccountDialogStage {...overlays.connectAccount} />
      <RemoveAccountStage {...common.removeAccount} />
      <MutationWorkflowStage {...overlays.mutation} />
      <PreviewModalStage {...overlays.preview} />
    </div>
  );
}
