import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { AppShellCommonBindings } from "./AppShell";
import {
  projectAppShell,
  type AppBootstrapBindings,
  type AppShellProjectionInput,
  type AppWorkspaceBindings,
  type AppWorkspaceOverlayBindings,
  type AppWorkspaceStatusBindings
} from "./projectAppShell";
import { projectSettingsDialogStage } from "../features/settings/workspace/projectSettingsDialogStage";
import { projectAccountSettingsBindings } from "../features/accounts/actions/workspace/projectAccountSettingsBindings";
import type {
  SettingsDialogStageProjectionInput,
  SettingsPreferencesWorkspaceCommands
} from "../features/settings/workspace/ports";
import { DEFAULT_UI_SETTINGS, type UiSettings } from "../features/settings/model";
import { buildAccount } from "../test/accounts";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const appSource = source("../App.tsx");
const appShellSource = source("./AppShell.tsx");
const projectionSource = source("./projectAppShell.ts");
const futureProjectorPath = fileURLToPath(import.meta.url).replace(
  /appShellComposition\.characterization\.test\.tsx?$/,
  "projectAppShellComposition.ts"
);

function currentAssemblySource(): string {
  const start = appSource.indexOf("  const workspaceBindings:");
  const end = appSource.indexOf("  return <AppShell {...appShell} />;", start);
  if (start < 0 || end < 0) {
    throw new Error("App shell assembly markers are missing.");
  }
  return appSource.slice(start, end);
}

function sourcePolicyViolations(candidate: string): string[] {
  const violations: string[] = [];
  const allowedPublicImports = new Set([
    "./AppShell",
    "./projectAppShell",
    "../features/settings/workspace/projectSettingsDialogStage",
    "../features/settings/workspace/ports",
    "../features/accounts/actions/workspace/projectAccountSettingsBindings"
  ]);
  if (/\buse[A-Z][A-Za-z0-9_]*\s*\(|\buseEffect\s*\(|\buseMemo\s*\(/.test(candidate)) {
    violations.push("hook");
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\b(?:setTimeout|setInterval)\s*\(/.test(candidate)) {
    violations.push("effect");
  }
  if (/\b(?:import\s*\(|require\s*\(|module\.require\s*\()/.test(candidate)) {
    violations.push("dynamic-import");
  }
  if (/\b(?:sendBeacon|readItem|writeItem|deleteItem|clear\s*\(|createAbort|subscribe)\s*\(/.test(candidate)) {
    violations.push("port-side-effect");
  }
  if (/\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB)\b/.test(candidate)) {
    violations.push("platform");
  }
  if (/\b(?:password|secret|unlockCode|accessToken|sessionToken)\b/i.test(candidate)) {
    violations.push("secret");
  }
  if (/\b(?:if|switch)\s*\([^)]*(?:bootstrap|continue|gate)/.test(candidate)) {
    violations.push("branch");
  }
  for (const match of candidate.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)) {
    const modulePath = match[1] ?? "";
    if (allowedPublicImports.has(modulePath)) continue;
    if (/^\.{1,2}\//.test(modulePath)) {
      violations.push(modulePath.includes("features/") ? "feature-internal-import" : "non-public-import");
    } else {
      violations.push("external-import");
    }
  }
  return violations;
}

function sentinel<T>(label: string): T {
  // The opaque object is intentionally structurally cast: AppShell leaf props are
  // not invoked by this pure projection characterization, but each label must have
  // a distinct runtime identity so cross-wiring is observable.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return Object.freeze({ label }) as T;
}

function workspaceBindings(showDetailsRail: boolean): AppWorkspaceBindings {
  return {
    className: `workspace-layout${showDetailsRail ? "" : " workspace-layout-full"}`,
    pullToRefresh: sentinel("pull-to-refresh"),
    browsePanelClassName: "browse-panel-with-audio",
    browseHeader: sentinel("browse-header"),
    folderAudio: sentinel("folder-audio"),
    fileList: sentinel("file-list"),
    selectionDetails: sentinel("selection-details"),
    quickActions: sentinel("quick-actions")
  };
}

function settingsInput(overrides: Partial<SettingsDialogStageProjectionInput> = {}): SettingsDialogStageProjectionInput {
  const commands: SettingsPreferencesWorkspaceCommands = {
    handleFileSizeDisplayModeChange: vi.fn(),
    handleThemeModeChange: vi.fn(),
    handleMaxCacheableFileSizeChange: vi.fn(),
    handleImagePreviewFitModeChange: vi.fn(),
    handlePreviewFreshnessIntervalChange: vi.fn(),
    handleKeepAwakeEnabledChange: vi.fn(),
    handleShowHiddenFilesChange: vi.fn(),
    handleExperimentalHeicPreviewEnabledChange: vi.fn(),
    handleExperimentalFolderAppShortcutsEnabledChange: vi.fn(),
    handleDiagnosticsEnabledChange: vi.fn(),

    handleSortModeChange: vi.fn()
  };
  const preferences: UiSettings = { ...DEFAULT_UI_SETTINGS, themeMode: "dark", showHiddenFiles: true };
  const onClose = vi.fn();
  const onDismissFromScrim = vi.fn();
  return {
    preferences,
    commands,
    surface: { open: true, closeActionLabel: "Close", onClose, onDismissFromScrim },
    accounts: {
      accounts: [],
      pendingRemovalAccounts: [],
      connectedAccountCount: 0,
      onActiveAccountChange: vi.fn(),
      onOpenAddAccount: vi.fn(),
      onOpenReconnect: vi.fn(),
      onOpenRemove: vi.fn()
    },
    cache: {
      summary: { itemCount: 2, totalBytes: 20, limitBytes: 100 },
      offlineItems: [],
      onClearCache: vi.fn(),
      onRemoveOfflineItem: vi.fn(),
      onOpenedFileCacheLimitChange: vi.fn()
    },
    diagnostics: {
      onOpenReport: vi.fn(),
      onClearData: vi.fn()
    },
    runtime: { appBuildLabel: "build-test", offline: false, backendActionsDisabled: false, keepAwakeState: "active" },
    ...overrides
  };
}

function settingsStage(narrow: boolean, browserOffline: boolean, explicitOffline: boolean) {
  const input = settingsInput({
    surface: {
      open: true,
      closeActionLabel: narrow ? "Done" : "Close",
      onClose: vi.fn(),
      onDismissFromScrim: vi.fn()
    },
    runtime: {
      appBuildLabel: "build-test",
      offline: browserOffline || explicitOffline,
      backendActionsDisabled: explicitOffline,
      keepAwakeState: "active"
    }
  });
  return { input, stage: projectSettingsDialogStage(input) };
}

function shellInput(gateKind: AppBootstrapBindings["gate"]["kind"], showDetailsRail: boolean): {
  input: AppShellProjectionInput;
  settings: NonNullable<AppShellCommonBindings["settings"]>;
} {
  const settings = settingsStage(false, false, false).stage;
  const common: AppShellCommonBindings = {
    reloadPrompt: sentinel("reload-prompt"),
    appBar: sentinel("app-bar"),
    navigationDrawer: { key: "account-alpha", props: sentinel("navigation-drawer") },
    removeAccount: sentinel("remove-account"),
    settings
  };
  const workspace = workspaceBindings(showDetailsRail);
  const status: AppWorkspaceStatusBindings = {
    banner: sentinel("folder-inline-banner"),
    offlineToggle: sentinel("offline-toggle")
  };
  const overlays: AppWorkspaceOverlayBindings = {
    settings,
    folderShortcut: sentinel("folder-shortcut"),
    offlineSync: sentinel("offline-sync"),
    connectAccount: sentinel("connect-account"),
    mutation: sentinel("mutation"),
    preview: sentinel("preview")
  };
  return {
    input: {
      common,
      bootstrap: {
        bootstrapError: "registry-first-error",
        connectStage: sentinel("bootstrap-connect"),
        gate: { kind: gateKind },
        restoreStage: sentinel("restore"),
        unlockStage: sentinel("unlock")
      },
      status,
      workspace,
      overlays
    },
    settings
  };
}

describe("App shell composition characterization", () => {
  it("locks the current final assembly and its 816-line source fingerprint", () => {
    const hasProjector = existsSync(futureProjectorPath);
    const assembly = hasProjector ? readFileSync(futureProjectorPath, "utf8") : currentAssemblySource();
    if (!hasProjector) {
      expect(appSource.split("\n").filter((line, index, lines) => !(index === lines.length - 1 && line === "")).length).toBe(816);
      expect(createHash("sha256").update(appSource).digest("hex")).toBe("5e9d43d34ea8b8e59521f8878d5f89db5493962373a0abb576b579442202da99");
    } else {
      expect(appSource).not.toContain("const overlayBindings:");
      expect(assembly).toContain("export function projectAppShellComposition");
    }
    const markers = hasProjector
      ? [
          "export function projectAppShellComposition",
          "const settingsStage = projectSettingsDialogStage({",
          "accounts: projectAccountSettingsBindings(input.settings.accounts)",
          "closeActionLabel: input.settings.isNarrowScreen ? \"Done\" : \"Close\"",
          "offline: input.settings.runtime.offline || input.settings.runtime.explicitOfflineMode",
          "backendActionsDisabled: input.settings.runtime.explicitOfflineMode",
          "const commonShellBindings: AppShellCommonBindings = {",
          "...input.common,",
          "const workspaceBindings: AppWorkspaceBindings =",
          "pullToRefresh: input.workspace.pullToRefresh",
          "browsePanelClassName: input.workspace.browsePanelClassName",
          "browseHeader: input.workspace.browseHeader",
          "folderAudio: input.workspace.folderAudio",
          "fileList: input.workspace.fileList",
          "selectionDetails: input.workspace.selectionDetails",
          "quickActions: input.workspace.quickActions",
          "banner: input.status.banner",
          "browserOffline: input.status.browserOffline",
          "workerUnavailable: input.status.workerUnavailable",
          "bootstrapError: input.bootstrap.registryNotice ?? input.bootstrap.accountBootstrapError",
          "connectStage: input.bootstrap.connectStage",
          "gate: input.bootstrap.gate",
          "restoreStage: input.bootstrap.restoreStage",
          "unlockStage: input.bootstrap.unlockStage",
          "offlineToggle: input.status.shellToggle({",
          "...input.overlays,",
          "return projectAppShell({"
        ]
      : [
          "const workspaceBindings:",
          "className: `workspace-layout${showDetailsRail ? \"\" : \" workspace-layout-full\"}`",
          "pullToRefresh: pullToRefreshWorkspace.shell",
          "browseHeader: browsingSurface.browseHeader",
          "folderAudio: { interaction: folderAudio.interaction }",
          "fileList: browsingSurface.fileList",
          "selectionDetails: selectionDetailsStage",
          "const settingsStage = projectSettingsDialogStage({",
          "accounts: projectAccountSettingsBindings({",
          "accounts: accountContext.operationalAccounts",
          "activeAccount,",
          "managementActiveAccount: accountContext.managementActiveAccount",
          "pendingRemovalAccounts: accountContext.pendingRemovalAccounts",
          "activeAccountId: activeAccount?.id",
          "connectedAccountCount: accountContext.totalAccountCount",
          "commands: accountActionsWorkspace.commands",
          "cache: offlineApplication.settingsCache",
          "appBuildLabel: APP_BUILD_LABEL",
          "keepAwakeState: wakeLock.state",
          "closeActionLabel: isNarrowScreen ? \"Done\" : \"Close\"",
          "onClose: () => chromeSurfaces.closeChrome(\"settings\")",
          "onDismissFromScrim: () => chromeSurfaces.closeChrome(\"settings\")",
          "offline: offline || explicitOfflineMode",
          "backendActionsDisabled: explicitOfflineMode",
          "const overlayBindings:",
          "settings: settingsStage",
          "reloadPrompt: pwaWorkspace.reloadPrompt",
          "appBar: appBarWorkspace.binding",
          "navigationDrawer: navigationDrawerWorkspace.binding",
          "removeAccount: accountActionsWorkspace.stages.removeDialog",
          "connectStage: accountActionsWorkspace.stages.bootstrapConnect",
          "gate: accountBootstrapGate",
          "restoreStage",
          "unlockStage",
          "banner: folderInlineBanner",
          "offlineSync: offlineSyncStage",
          "connectAccount: accountActionsWorkspace.stages.connectDialog",
          "mutation: operationWorkspace.mutation.stage",
          "preview: previewWorkspace.stage",
          "bootstrapError: accountContext.registryNotice ?? accountBootstrapError",
          "offlineApplication.shellToggle({ browserOffline: offline, workerUnavailable })",
          "const appShell = projectAppShell({"
        ];
    for (const marker of markers) {
      expect(assembly, `missing current assembly marker: ${marker}`).toContain(marker);
    }
    expect((assembly.match(/settings: settingsStage/g) ?? []).length).toBe(2);
    expect(appShellSource).toContain("export function AppShell(props: AppShellProps)");
    expect(projectionSource).toContain("if (input.bootstrap.gate.kind !== \"continue\")");
  });

  it.each([true, false])("preserves details-rail class and every workspace binding by identity (%s)", (showDetailsRail) => {
    const { input } = shellInput("continue", showDetailsRail);
    const projected = projectAppShell(input);
    expect(projected.kind).toBe("workspace");
    if (projected.kind !== "workspace") throw new Error("Expected workspace projection.");
    expect(projected.workspace.className).toBe(showDetailsRail ? "workspace-layout" : "workspace-layout workspace-layout-full");
    expect(projected.workspace.pullToRefresh).toBe(input.workspace.pullToRefresh);
    expect(projected.workspace.browseHeader).toBe(input.workspace.browseHeader);
    expect(projected.workspace.folderAudio).toBe(input.workspace.folderAudio);
    expect(projected.workspace.fileList).toBe(input.workspace.fileList);
    expect(projected.workspace.selectionDetails).toBe(input.workspace.selectionDetails);
    expect(projected.workspace.quickActions).toBe(input.workspace.quickActions);
  });

  it("preserves shell binding identity and shares settings between common chrome and overlays", () => {
    const { input } = shellInput("continue", true);
    const projected = projectAppShell(input);
    expect(projected.kind).toBe("workspace");
    if (projected.kind !== "workspace") throw new Error("Expected workspace projection.");
    expect(projected.common).toBe(input.common);
    expect(projected.status).toBe(input.status);
    expect(projected.workspace).toBe(input.workspace);
    expect(projected.overlays).toBe(input.overlays);
    expect(projected.common.reloadPrompt).toBe(input.common.reloadPrompt);
    expect(projected.common.appBar).toBe(input.common.appBar);
    expect(projected.common.navigationDrawer).toBe(input.common.navigationDrawer);
    expect(projected.common.removeAccount).toBe(input.common.removeAccount);
    expect(projected.common.settings).toBe(projected.overlays.settings);
    expect(projected.workspace.browseHeader).toBe(input.workspace.browseHeader);
    expect(projected.workspace.folderAudio).toBe(input.workspace.folderAudio);
    expect(projected.workspace.fileList).toBe(input.workspace.fileList);
    expect(projected.workspace.selectionDetails).toBe(input.workspace.selectionDetails);
    expect(projected.workspace.quickActions).toBe(input.workspace.quickActions);
    expect(projected.overlays.offlineSync).toBe(input.overlays.offlineSync);
    expect(projected.overlays.connectAccount).toBe(input.overlays.connectAccount);
    expect(projected.overlays.mutation).toBe(input.overlays.mutation);
    expect(projected.overlays.preview).toBe(input.overlays.preview);
  });

  it.each([false, true])("projects settings runtime and close policy (%s)", (narrow) => {
    const { input, stage } = settingsStage(narrow, true, false);
    expect(stage.closeActionLabel).toBe(narrow ? "Done" : "Close");
    expect(stage.offline).toBe(true);
    expect(stage.backendActionsDisabled).toBe(false);
    expect(stage.appBuildLabel).toBe(input.runtime.appBuildLabel);
    expect(stage.keepAwakeState).toBe(input.runtime.keepAwakeState);
    expect(stage.onClose).toBe(input.surface.onClose);
    expect(stage.onDismissFromScrim).toBe(input.surface.onDismissFromScrim);
    expect(stage.onThemeModeChange).toBe(input.commands.handleThemeModeChange);
  });

  it("routes settings close and scrim dismissal to the same settings surface command", () => {
    const closeChrome = vi.fn<(surface: string) => void>();
    const input = settingsInput({
      surface: {
        open: true,
        closeActionLabel: "Close",
        onClose: () => { closeChrome("settings"); },
        onDismissFromScrim: () => { closeChrome("settings"); }
      }
    });
    const stage = projectSettingsDialogStage(input);
    stage.onClose();
    stage.onDismissFromScrim?.();
    expect(closeChrome).toHaveBeenCalledTimes(2);
    expect(closeChrome).toHaveBeenNthCalledWith(1, "settings");
    expect(closeChrome).toHaveBeenNthCalledWith(2, "settings");
  });

  it("preserves account, cache, preference, and command projector outputs", () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha" });
    const commands = {
      switchActive: vi.fn(),
      openAddFromSettings: vi.fn(),
      openReconnectFromSettings: vi.fn(),
      openRemoveFromSettings: vi.fn()
    };
    const accounts = projectAccountSettingsBindings({
      accounts: [alpha],
      activeAccount: alpha,
      managementActiveAccount: alpha,
      pendingRemovalAccounts: [],
      activeAccountId: alpha.id,
      connectedAccountCount: 1,
      commands
    });
    expect(accounts.accounts).toEqual([alpha]);
    expect(accounts.activeAccount).toBe(alpha);
    expect(accounts.onActiveAccountChange).toBe(commands.switchActive);
    expect(accounts.onOpenAddAccount).toBe(commands.openAddFromSettings);
    expect(accounts.onOpenReconnect).toBe(commands.openReconnectFromSettings);
    expect(accounts.onOpenRemove).toBe(commands.openRemoveFromSettings);

    const { input, stage } = settingsStage(false, false, false);
    expect(stage.cacheSummary).toEqual(input.cache.summary);
    expect(stage.onClearCache).toBe(input.cache.onClearCache);
    expect(stage.onRemoveOfflineItem).toBe(input.cache.onRemoveOfflineItem);
    expect(stage.onOpenedFileCacheLimitChange).toBe(input.cache.onOpenedFileCacheLimitChange);
    expect(stage.onMaxCacheableFileSizeChange).toBe(input.commands.handleMaxCacheableFileSizeChange);
    expect(stage.onPreviewFreshnessIntervalChange).toBe(input.commands.handlePreviewFreshnessIntervalChange);
    expect(stage.onKeepAwakeEnabledChange).toBe(input.commands.handleKeepAwakeEnabledChange);
    expect(stage.onThemeModeChange).toBe(input.commands.handleThemeModeChange);
    expect(stage.onShowHiddenFilesChange).toBe(input.commands.handleShowHiddenFilesChange);
    expect(stage.onExperimentalHeicPreviewEnabledChange).toBe(input.commands.handleExperimentalHeicPreviewEnabledChange);
  });

  it("derives explicit-offline action disabling without conflating browser connectivity", () => {
    const browserOffline = settingsStage(false, true, false).stage;
    const explicitOffline = settingsStage(false, false, true).stage;
    expect(browserOffline.offline).toBe(true);
    expect(browserOffline.backendActionsDisabled).toBe(false);
    expect(explicitOffline.offline).toBe(true);
    expect(explicitOffline.backendActionsDisabled).toBe(true);
  });

  it.each(["unavailable", "healthChecking", "noAccounts", "connect", "reconnect", "unlock", "restore"] as const)(
    "keeps %s in the bootstrap branch with bootstrap error precedence",
    (kind) => {
      const { input } = shellInput(kind, true);
      const projected = projectAppShell(input);
      expect(projected.kind).toBe("bootstrap");
      if (projected.kind !== "bootstrap") throw new Error("Expected bootstrap projection.");
      expect(projected.bootstrap).toBe(input.bootstrap);
      expect(projected.bootstrap.bootstrapError).toBe("registry-first-error");
    }
  );

  it("keeps the continue branch separate from bootstrap and forwards status exactly", () => {
    const { input } = shellInput("continue", true);
    const projected = projectAppShell(input);
    expect(projected.kind).toBe("workspace");
    if (projected.kind !== "workspace") throw new Error("Expected workspace projection.");
    expect(projected.status).toBe(input.status);
    expect(projected.status.banner).toBe(input.status.banner);
    expect(projected.status.offlineToggle).toBe(input.status.offlineToggle);
  });

  it("rejects hooks, effects, platform access, secrets, feature-internal imports, and a second branch policy", () => {
    const clean = existsSync(futureProjectorPath) ? readFileSync(futureProjectorPath, "utf8") : currentAssemblySource();
    for (const mutation of [
      `${clean}\nconst hook = useMemo(() => ({}), []);`,
      `${clean}\nfetch(\"/api/health\");`,
      `${clean}\nconst browserState = window.localStorage.getItem(\"x\");`,
      `${clean}\nconst secret = sessionToken;`,
      `${clean}\nimport { privateThing } from \"../features/accounts/internal\";`,
      `${clean}\nimport { createBrowserPort } from \"../platform/browser\";`,
      `${clean}\nimport { useMemo } from \"react\";`,
      `${clean}\nconst imported = await import(\"../features/accounts/workspace\");`,
      `${clean}\nconst moduleValue = require(\"../AppShell\");`,
      `${clean}\nconst storage = cache.readItem();`,
      `${clean}\nif (input.bootstrap.gate.kind === \"continue\") return input.workspace;`
    ]) {
      expect(sourcePolicyViolations(mutation).length).toBeGreaterThan(0);
    }
    expect(sourcePolicyViolations(clean)).toEqual([]);
  });
});
