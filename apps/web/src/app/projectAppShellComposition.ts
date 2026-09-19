import type { AppShellCommonBindings, AppShellProps } from "./AppShell";
import {
  projectAppShell,
  type AppBootstrapBindings,
  type AppWorkspaceBindings,
  type AppWorkspaceOverlayBindings,
  type AppWorkspaceStatusBindings
} from "./projectAppShell";
import {
  projectAccountSettingsBindings,
  type AccountSettingsProjectionInput
} from "../features/accounts/actions/workspace/projectAccountSettingsBindings";
import { projectSettingsDialogStage } from "../features/settings/workspace/projectSettingsDialogStage";
import type {
  SettingsDialogStageProjectionInput,
  SettingsPreferencesWorkspaceCommands
} from "../features/settings/workspace/ports";

type AppShellStatusToggleInput = {
  readonly browserOffline: boolean;
  readonly workerUnavailable: boolean;
};

export interface AppShellCompositionInput {
  readonly showDetailsRail: boolean;
  readonly common: Omit<AppShellCommonBindings, "settings">;
  readonly workspace: {
    readonly pullToRefresh: AppWorkspaceBindings["pullToRefresh"];
    readonly browsePanelClassName: string;
    readonly browseHeader: AppWorkspaceBindings["browseHeader"];
    readonly folderAudio: AppWorkspaceBindings["folderAudio"];
    readonly fileList: AppWorkspaceBindings["fileList"];
    readonly selectionDetails: AppWorkspaceBindings["selectionDetails"];
  };
  readonly settings: {
    readonly preferences: SettingsDialogStageProjectionInput["preferences"];
    readonly commands: SettingsPreferencesWorkspaceCommands;
    readonly open: boolean;
    readonly isNarrowScreen: boolean;
    readonly closeChrome: (surface: "settings") => void;
    readonly accounts: AccountSettingsProjectionInput;
    readonly cache: SettingsDialogStageProjectionInput["cache"];
    readonly runtime: {
      readonly appBuildLabel: string;
      readonly offline: boolean;
      readonly explicitOfflineMode: boolean;
      readonly keepAwakeState: SettingsDialogStageProjectionInput["runtime"]["keepAwakeState"];
    };
  };
  readonly bootstrap: {
    readonly registryNotice?: string;
    readonly accountBootstrapError?: string;
    readonly connectStage: AppBootstrapBindings["connectStage"];
    readonly gate: AppBootstrapBindings["gate"];
    readonly restoreStage: AppBootstrapBindings["restoreStage"];
    readonly unlockStage: AppBootstrapBindings["unlockStage"];
  };
  readonly status: {
    readonly banner: AppWorkspaceStatusBindings["banner"];
    readonly browserOffline: boolean;
    readonly workerUnavailable: boolean;
    readonly shellToggle: (input: AppShellStatusToggleInput) => AppWorkspaceStatusBindings["offlineToggle"];
  };
  readonly overlays: Omit<AppWorkspaceOverlayBindings, "settings">;
}

export function projectAppShellComposition(input: AppShellCompositionInput): AppShellProps {
  const settingsStage = projectSettingsDialogStage({
    preferences: input.settings.preferences,
    commands: input.settings.commands,
    surface: {
      open: input.settings.open,
      closeActionLabel: input.settings.isNarrowScreen ? "Done" : "Close",
      onClose: () => { input.settings.closeChrome("settings"); },
      onDismissFromScrim: () => { input.settings.closeChrome("settings"); }
    },
    accounts: projectAccountSettingsBindings(input.settings.accounts),
    cache: input.settings.cache,
    runtime: {
      appBuildLabel: input.settings.runtime.appBuildLabel,
      offline: input.settings.runtime.offline || input.settings.runtime.explicitOfflineMode,
      backendActionsDisabled: input.settings.runtime.explicitOfflineMode,
      keepAwakeState: input.settings.runtime.keepAwakeState
    }
  });

  const workspaceBindings: AppWorkspaceBindings = {
    className: `workspace-layout${input.showDetailsRail ? "" : " workspace-layout-full"}`,
    pullToRefresh: input.workspace.pullToRefresh,
    browsePanelClassName: input.workspace.browsePanelClassName,
    browseHeader: input.workspace.browseHeader,
    folderAudio: input.workspace.folderAudio,
    fileList: input.workspace.fileList,
    selectionDetails: input.workspace.selectionDetails
  };

  const commonShellBindings: AppShellCommonBindings = {
    ...input.common,
    settings: settingsStage
  };

  return projectAppShell({
    common: commonShellBindings,
    bootstrap: {
      bootstrapError: input.bootstrap.registryNotice ?? input.bootstrap.accountBootstrapError,
      connectStage: input.bootstrap.connectStage,
      gate: input.bootstrap.gate,
      restoreStage: input.bootstrap.restoreStage,
      unlockStage: input.bootstrap.unlockStage
    },
    status: {
      banner: input.status.banner,
      offlineToggle: input.status.shellToggle({
        browserOffline: input.status.browserOffline,
        workerUnavailable: input.status.workerUnavailable
      })
    },
    workspace: workspaceBindings,
    overlays: {
      ...input.overlays,
      settings: settingsStage
    }
  });
}
