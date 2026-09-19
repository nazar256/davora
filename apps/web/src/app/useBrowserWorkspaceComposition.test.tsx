import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  resolve(process.cwd(), "src/App.tsx"),
  "utf8"
);

const compositionPath = resolve(process.cwd(), "src/app/useBrowserWorkspaceComposition.tsx");
const compositionSource = readFileSync(compositionPath, "utf8");

describe("browser workspace composition boundary", () => {
  it("keeps App as a services-to-shell entrypoint", () => {
    expect(appSource).toContain('import { useBrowserWorkspaceComposition } from "./app/useBrowserWorkspaceComposition";');
    expect(appSource).toContain("const appShell = useBrowserWorkspaceComposition(services);");
    expect(appSource).toContain("return <AppShell {...appShell} />;");
    expect(appSource).not.toMatch(/use(?:Account|Browsing|Operations|Preview|Offline|Navigation|Settings|Pwa|Workspace|Transfers)/);
    expect(appSource).not.toContain("createBrowserThemePorts");
    expect(appSource).not.toContain("createBrowserScreenWakeLockPort");
    expect(appSource).not.toContain("applyBrowserDirectoryUploadAttributes");
  });

  it("keeps the complete owner graph inside the explicit composition boundary", () => {
    for (const owner of [
      "useAccountStateWorkspace",
      "useAccountBootstrapWorkspace",
      "useAccountActionsWorkspace",
      "useBrowsingApplicationWorkspace",
      "useOperationsApplicationWorkspace",
      "useOfflineApplicationWorkspace",
      "useOfflineSyncWorkspace",
      "usePreviewWorkspace",
      "useNavigationSurfaceWorkspace",
      "useAppWorkspacePresentation"
    ]) {
      expect(compositionSource).toContain(owner);
    }
    expect(compositionSource).toContain("accountActionsBridgeRef.current.resetSession");
    expect(compositionSource).toContain("previewWorkspaceBridgeRef.current");
    expect(compositionSource).toContain("workspacePathPortsRef.current");
    expect(compositionSource).toContain("services: { favourites: services.favourites");
    expect(compositionSource).not.toContain("<AppShell");
  });

  it("keeps cross-feature bridges explicit and invocation-current", () => {
    for (const bridge of [
      "accountActionsBridgeRef",
      "dismissMutationWorkflowRef",
      "previewWorkspaceBridgeRef",
      "setWorkerUnavailableRef",
      "workspacePathPortsRef"
    ]) {
      expect(compositionSource).toContain(`const ${bridge} = useRef`);
      expect(compositionSource).toContain(`${bridge}.current`);
    }

    expect(compositionSource).toContain("clearSelectedEntry: focusedSelection.clear");
    expect(compositionSource).toContain("clearBatchSelection: clearBatchSelectionState");
    expect(compositionSource).toContain("closeDestinationPicker: () => dismissMutationWorkflowRef.current()");
    expect(compositionSource).toContain('closePreview: () => previewWorkspaceBridgeRef.current?.dismiss("preview")');
    expect(compositionSource).toContain("pauseFolderAudio: () => previewWorkspaceBridgeRef.current?.pauseForExclusivePlayback()");
    expect(compositionSource).toContain('openTransferTray: () => { chromeSurfaces.openChrome("transfers"); }');
  });

  it("injects platform runtimes through services and keeps presentation projection last", () => {
    for (const runtime of [
      "services.accountRemovalRuntime",
      "services.explicitOfflineRuntime",
      "services.operationRuntime",
      "services.offlineSyncRuntime",
      "services.previewRuntime",
      "services.retentionRepository"
    ]) {
      expect(compositionSource).toContain(runtime);
    }

    expect(compositionSource).toContain("applyBrowserDirectoryUploadAttributes");
    expect(compositionSource).toContain("projectSelectionStateBindings(selectionStateWorkspace)");
    expect(compositionSource).toContain("return useAppWorkspacePresentation({");
    expect(compositionSource.indexOf("return useAppWorkspacePresentation({"))
      .toBeGreaterThan(compositionSource.indexOf("previewWorkspaceBridgeRef.current = previewWorkspace.bridge;"));
  });
});
