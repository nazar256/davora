// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

import type { FileEntry } from "@davora/shared";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as ts from "typescript";

import { buildFileEntry } from "../../../../test/files";
import { SelectionDetailsStage } from "../SelectionDetailsStage";
import { projectSelectionWorkspacePresentation } from "./projectSelectionWorkspacePresentation";
import { createBatchSelectionState, toggleBatchSelection } from "../model";
import { selectBatchArchiveInput, selectBatchEntries } from "../selectors";
import type { SelectionActionCapabilities, SelectionWorkspacePresentationInput } from "./ports";
import { createOperationContextToken } from "../../download/../policy";
import { useDownload } from "../../download/useDownload";
import { useDownloadWorkspace } from "../../download/workspace/useDownloadWorkspace";
import type { UseDownloadWorkspaceInput } from "../../download/workspace/ports";
import type { DownloadOrchestrationPorts } from "../../download/orchestrationPorts";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, "../../../../../../../");
const applicationPresentationPath = resolve(workspaceRoot, "apps/web/src/app/useAppWorkspacePresentation.ts");
const projectorPath = resolve(sourceDir, "./projectSelectionWorkspacePresentation.ts");
const selectionPortsPath = resolve(sourceDir, "./ports.ts");
const selectionStagePath = resolve(sourceDir, "../SelectionDetailsStage.tsx");
const batchHookPath = resolve(sourceDir, "../useBatchSelection.ts");
const selectorsPath = resolve(sourceDir, "../selectors.ts");
const modelPath = resolve(sourceDir, "../model.ts");
const downloadWorkspacePath = resolve(workspaceRoot, "apps/web/src/features/operations/download/workspace/useDownloadWorkspace.ts");
const downloadWorkspacePortsPath = resolve(workspaceRoot, "apps/web/src/features/operations/download/workspace/ports.ts");
const downloadUsePath = resolve(workspaceRoot, "apps/web/src/features/operations/download/useDownload.ts");
const downloadOrchestrationPath = resolve(workspaceRoot, "apps/web/src/features/operations/download/orchestration.ts");
const browsingBindingsPath = resolve(workspaceRoot, "apps/web/src/features/browsing/workspace/projectBrowsingSurfaceBindings.ts");
const characterizationPath = fileURLToPath(import.meta.url);
const evidenceDir = resolve(workspaceRoot, ".tmp/agent-artifacts/worker/app-batch-selection-download-bridge-characterization-20260830");

const read = (path: string): string => readFileSync(path, "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const count = (source: string, needle: string): number => source.split(needle).length - 1;
const replaceOnce = (source: string, search: string, replacement: string): string => {
  expect(count(source, search), `mutant source contains ${search}`).toBe(1);
  return source.replace(search, replacement);
};
const blockBetween = (source: string, start: string, end: string): string => {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  return first >= 0 && last > first ? source.slice(first, last) : "";
};

const appSource = read(applicationPresentationPath);
const projectorSource = read(projectorPath);
const selectionPortsSource = read(selectionPortsPath);
const stageSource = read(selectionStagePath);
const batchHookSource = read(batchHookPath);
const selectorsSource = read(selectorsPath);
const modelSource = read(modelPath);
const downloadWorkspaceSource = read(downloadWorkspacePath);
const downloadWorkspacePortsSource = read(downloadWorkspacePortsPath);
const downloadUseSource = read(downloadUsePath);
const downloadOrchestrationSource = read(downloadOrchestrationPath);
const browsingBindingsSource = read(browsingBindingsPath);

const appProjectionLine = "const selectionPresentation = projectSelectionWorkspacePresentation({";
const appBrowsingProjectionLine = "const browsingSurface = projectBrowsingSurfaceBindings({";
const appBatchLine = "downloadBatch: () => { void operationWorkspace.download.downloadBatch(); },";
const projectorBatchLine = "onDownloadBatchSelection: input.commands.downloadBatch,";
const browsingBatchLine = "onDownloadSelection: () => { void operation.download.downloadBatch(); },";

function appSelectionProjection(source: string): string {
  return blockBetween(source, appProjectionLine, appBrowsingProjectionLine);
}

function appBatchBlock(source: string): string {
  return blockBetween(appSelectionProjection(source), "      downloadBatch:", "      keepOfflineFocused:");
}

function arrowExpression(line: string): string {
  const colon = line.indexOf(":");
  return colon < 0 ? "" : line.slice(colon + 1).replace(/,$/, "").trim();
}

function assertAppBatch(source: string): void {
  const selection = appSelectionProjection(source);
  const batch = appBatchBlock(source);
  expect(count(source, appProjectionLine)).toBe(1);
  expect(count(source, appBrowsingProjectionLine)).toBe(1);
  expect(count(source, appBatchLine)).toBe(1);
  expect(selection).toContain(appBatchLine);
  expect(batch).toContain("downloadBatch");
  expect(batch).toMatch(/\(\)\s*=>\s*\{\s*void operationWorkspace\.download\.downloadBatch\(\);\s*\}/);
  expect(batch).not.toMatch(/entries|archive|selection|focused|preview|await|return|catch|Promise|retry|encode/i);
}

function assertProjector(source: string): void {
  expect(count(source, projectorBatchLine)).toBe(1);
  expect(source).toContain("const detailsStage: SelectionDetailsStageProps = {");
  expect(source).not.toMatch(/onDownloadBatchSelection:\s*(?:\(\)\s*=>|input\.commands\.downloadFocused|input\.selection)/);
}

function projectorBatchBlock(source: string): string {
  return blockBetween(source, "    onDownloadBatchSelection:", "    onKeepOfflineBatchSelection:");
}

function assertStage(source: string): void {
  expect(count(source, "disabled={!props.canDownloadBatchSelection}")).toBe(2);
  expect(count(source, "onClick={props.onDownloadBatchSelection}")).toBe(2);
  expect(source).toContain("Download selected");
  expect(source).toContain("className=\"mobile-batch-action\" disabled={!props.canDownloadBatchSelection} onClick={props.onDownloadBatchSelection}");
}

function assertBrowseSibling(source: string): void {
  expect(count(source, browsingBatchLine)).toBe(1);
  expect(source).toContain("selection.batch.entries");
  expect(source).toContain("selection.batch.archiveInput");
  expect(source).toContain("selection.batch.capture()");
}

function assertDownloadOwner(workspace: string, ports: string, use: string, orchestration: string): void {
  expect(workspace).toContain("const commands = useDownload(childInput);");
  expect(workspace).toContain("return { commands };");
  expect(workspace).toContain("getBatchEntries: () => snapshot.selection.entries,");
  expect(workspace).toContain("getBatchArchiveInput: () => snapshot.selection.archiveInput,");
  expect(workspace).toContain("selection: captureSelection(input.selection),");
  expect(ports).toContain("export function createDownloadWorkspacePorts");
  expect(use).toContain("const downloadBatch = useCallback(async () => {");
  expect(use).toContain("if (entries.length === 1 && !entries[0]?.isFolder)");
  expect(use).toContain("await runBatchDownloadOrchestration({");
  expect(orchestration).toContain("if (input.entries.length === 1 && !input.entries[0]?.isFolder)");
  expect(orchestration).toContain("ports.batch.downloadSelectionAsZip({");
  expect(orchestration).toContain("ports.files.triggerBrowserDownload(blob, plan.archiveName);");
  expect(orchestration).toContain("scope.release();");
  expect(workspace).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|setTimeout\(|setInterval\(|addEventListener\(/);
}

function assertBridgeNeutral(app: string, projector: string): void {
  const forbidden = /clearFocused|clearBatch|batchSelection\.clear|showMobile|closeMobile|navigateTo|openFile|openChrome|openTransferTray|confirm|openOfflineSyncDialog|accountActionsBridgeRef|operationWorkspace\.download\.ports|archive|capture|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|addEventListener\(|setTimeout\(|setInterval\(|AbortController|retry|resetSession/i;
  expect(appBatchBlock(app)).not.toMatch(forbidden);
  expect(projector).not.toMatch(/onDownloadBatchSelection:\s*\(\)\s*=>/);
}

function assertPublicDirection(projector: string, ports: string): void {
  expect(projector).not.toMatch(/features\/operations\/download|operations\/download|useDownload/);
  expect(ports).not.toMatch(/features\/operations\/download|operations\/download|useDownload/);
  expect(ports).toContain("downloadBatch: () => void;");
}

type BatchCommand = () => unknown;
function compileAppBatch(source: string = appSource): (command: BatchCommand) => { downloadBatch: BatchCommand } {
  const line = source.split(/\r?\n/).find((value) => value.includes(appBatchLine)) ?? "";
  const script = `function createAppBatch(downloadBatch) { const operationWorkspace = { download: { downloadBatch } }; return { downloadBatch: ${arrowExpression(line)} }; }`;
  const output = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context: { createAppBatch?: (command: BatchCommand) => { downloadBatch: BatchCommand } } = {};
  runInNewContext(output, context);
  if (!context.createAppBatch) throw new Error("App batch adapter fixture did not compile");
  return context.createAppBatch;
}

function entry(path: string, isFolder = false): FileEntry {
  return buildFileEntry(path, { isFolder, mimeType: isFolder ? undefined : "text/plain", size: isFolder ? undefined : 5 });
}

function summary(countValue: number, fileCount: number, folderCount: number) {
  return { count: countValue, fileCount, folderCount, knownFileSizeBytes: fileCount * 5, unknownSizeCount: folderCount };
}

function capabilities(overrides: Partial<SelectionActionCapabilities> = {}): SelectionActionCapabilities {
  return {
    canMarkForBatchDownload: true, canDownloadSelected: true, canSyncSelectedOffline: true, canMoveSelected: true, canCopySelected: true,
    canDeleteSelected: true, canDownloadBatchSelection: true, canSyncBatchOffline: true,
    canCopyMoveBatchSelection: true, canDeleteBatchSelection: true, ...overrides
  };
}

type InputOverrides = {
  readonly selection?: Partial<SelectionWorkspacePresentationInput["selection"]>;
  readonly preview?: Partial<SelectionWorkspacePresentationInput["preview"]>;
  readonly workspace?: Partial<SelectionWorkspacePresentationInput["workspace"]>;
  readonly view?: Partial<SelectionWorkspacePresentationInput["view"]>;
  readonly capabilities?: Partial<SelectionActionCapabilities>;
  readonly commands?: Partial<SelectionWorkspacePresentationInput["commands"]>;
};

function buildInput(overrides: InputOverrides = {}): SelectionWorkspacePresentationInput {
  return {
    selection: { focusedEntry: undefined, focusedMobileSubview: "actions", batchSummary: summary(0, 0, 0), isBatchSelected: () => false, selectAllItems: [], ...overrides.selection },
    preview: { selected: undefined, ...overrides.preview },
    workspace: { folderLabel: "Projects", locationLabel: "/Projects", visibleItemCount: 2, searchActive: false, searchQuery: "", explicitOfflineMode: false, offline: false, workerUnavailable: false, folderCachedAt: undefined, ...overrides.workspace },
    view: { fileSizeDisplayMode: "human", isNarrowScreen: false, mobileDetailsOpen: false, mutationBusy: false, ...overrides.view },
    capabilities: capabilities(overrides.capabilities),
    favourite: { selected: false, toggle: vi.fn() },
    commands: {
      clearFocused: vi.fn(), clearBatch: vi.fn(), toggleSelectAll: vi.fn(), showMobileActions: vi.fn(), showMobileDetails: vi.fn(), closeMobileDetails: vi.fn(), navigateToFolder: vi.fn(), openFile: vi.fn(), openFolderShortcut: vi.fn(), downloadFocused: vi.fn(), downloadBatch: vi.fn(), keepOfflineFocused: vi.fn(), keepOfflineBatch: vi.fn(), renameFocused: vi.fn(), copyMoveFocused: vi.fn(), copyMoveBatch: vi.fn(), deleteFocused: vi.fn(), deleteBatch: vi.fn(), ...overrides.commands
    }
  };
}

function stageProps(overrides: Partial<ComponentProps<typeof SelectionDetailsStage>> = {}): ComponentProps<typeof SelectionDetailsStage> {
  return {
    visible: true, content: { kind: "batch", batch: { count: 2, countLabel: "2 items selected", selectionLabel: "2 files", fileCount: 2, folderCount: 0, sizeLabel: "10 B", ariaLabel: "Selection details for 2 items" } },
    showMobileBatchBar: false, showMobileSelectionSheet: false, mobileSheetDetailsExpanded: false, offline: false, mutationBusy: false,
    canDownloadSelected: false, canSyncSelectedOffline: false, selectedIsFavourite: false, selectedFavouriteActionLabel: "Add to Favourites", canMoveSelected: false, canCopySelected: false, canDeleteSelected: false,
    canDownloadBatchSelection: false, canSyncBatchOffline: false, canCopyMoveBatchSelection: false, canDeleteBatchSelection: false,
    selectAllState: "none", canSelectAll: false, canDeselectAll: false, onToggleSelectAll: vi.fn(),
    onOpenSelected: vi.fn(), onDownloadSelected: vi.fn(), onKeepOfflineSelected: vi.fn(), onToggleFavourite: vi.fn(), onFolderShortcut: vi.fn(), onToggleMobileSheetDetails: vi.fn(), onRenameSelected: vi.fn(), onCopyMoveSelected: vi.fn(), onDeleteSelected: vi.fn(), onDownloadBatchSelection: vi.fn(), onKeepOfflineBatchSelection: vi.fn(), onCopyMoveBatchSelection: vi.fn(), onDeleteBatchSelection: vi.fn(), onClearBatchSelection: vi.fn(), onCloseMobileSelectionSheet: vi.fn(), onCollapseMobileSheetDetails: vi.fn(), ...overrides
  };
}

function makePorts(overrides: Partial<DownloadOrchestrationPorts> = {}): DownloadOrchestrationPorts {
  const scope = { signal: new AbortController().signal, isRegistered: vi.fn(() => true), isOwned: vi.fn(() => true), release: vi.fn() };
  return {
    registry: { acquire: vi.fn(() => scope) },
    transfers: { createId: vi.fn(() => "download-1"), enqueue: vi.fn(), beginPreparation: vi.fn(), beginTransfer: vi.fn(), reportProgress: vi.fn(), reportFailure: vi.fn(), complete: vi.fn(), completePartial: vi.fn(), fail: vi.fn() },
    files: { prepareDownload: vi.fn(async () => ({ blob: new Blob(["file"]), filename: "file.txt" })), fetchBlob: vi.fn(), listFiles: vi.fn(async () => ({ items: [] })), triggerBrowserDownload: vi.fn() },
    batch: { downloadSelectionAsZip: vi.fn(async () => ({ blob: new Blob(["zip"]), plan: { archiveName: "selection.zip", selectedCount: 2, selectedFileCount: 2, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [], totalBytes: 10 } })) },
    context: { isCurrent: vi.fn(() => true) }, session: { terminateExpired: vi.fn(), terminateReconnectRequired: vi.fn() }, errors: { isUnauthorized: vi.fn(() => false), isReconnectRequired: vi.fn(() => false), toErrorMessage: vi.fn((_error: unknown, fallback: string): string => fallback) }, presentation: { reportStatus: vi.fn(), reportListError: vi.fn() }, ...overrides
  };
}

const characterization = { branches: [] as string[], adversaries: [] as string[] };

describe("App batch Selection -> Operations Download bridge Gate 1 characterization", () => {
  afterEach(cleanup);

  it("locks the exact two-hop boundary, owner chain, UI gate, and distinct Header sibling", () => {
    assertAppBatch(appSource); assertProjector(projectorSource); assertStage(stageSource);
    assertDownloadOwner(downloadWorkspaceSource, downloadWorkspacePortsSource, downloadUseSource, downloadOrchestrationSource);
    expect(batchHookSource).toContain("entries: selectBatchEntries(currentState)"); expect(modelSource).toContain("captureBatchSelection");
    assertBrowseSibling(browsingBindingsSource); assertPublicDirection(projectorSource, selectionPortsSource);
    characterization.branches.push("single-App-batch-provider", "single-Selection-batch-consumer", "public-Download-owner", "batch-Header-sibling-distinct", "public-cross-feature-direction");
  });

  it("projects one exact batch callback without eager invocation and preserves ordered membership/archive roots", () => {
    let state = createBatchSelectionState("alpha");
    for (const member of [
      [entry("Projects/one.txt"), { kind: "browse", folderPath: "Projects" }],
      [entry("Archive", true), { kind: "browse", folderPath: "" }],
      [entry("Search/two.txt"), { kind: "search", scopePath: "Search" }]
    ] as const) state = toggleBatchSelection(state, "alpha", member[0], member[1]).state;
    const entries = selectBatchEntries(state); const archive = selectBatchArchiveInput(state);
    expect(entries.map(({ path }) => path)).toEqual(["Projects/one.txt", "Archive", "Search/two.txt"]);
    expect(archive.roots.map(({ archiveRoot }) => archiveRoot)).toEqual(["one.txt", "Archive", "Search/two.txt"]);
    const command = vi.fn();
    const projected = projectSelectionWorkspacePresentation(buildInput({ selection: { batchSummary: summary(3, 2, 1) }, commands: { downloadBatch: command } }));
    expect(projected.detailsStage.onDownloadBatchSelection).toBe(command); expect(command).not.toHaveBeenCalled(); projected.detailsStage.onDownloadBatchSelection();
    expect(command).toHaveBeenCalledTimes(1); expect(projectorSource).not.toMatch(/onDownloadBatchSelection:\s*\(\)/);
    characterization.branches.push("ordered-entries", "archive-root-mapping", "exact-callback-identity", "no-eager-projection");
  });

  it("forwards zero App arguments, returns undefined, and retains synchronous error identity", () => {
    const command = vi.fn<BatchCommand>(() => Promise.resolve());
    const adapter = compileAppBatch()(command);
    expect(adapter.downloadBatch()).toBeUndefined(); expect(command).toHaveBeenCalledTimes(1); expect(command.mock.calls[0]).toHaveLength(0);
    const sentinel = new Error("batch App download sentinel"); const throwing = vi.fn<BatchCommand>(() => { throw sentinel; });
    expect(() => compileAppBatch()(throwing).downloadBatch()).toThrow(sentinel); expect(throwing).toHaveBeenCalledTimes(1);
    expect(appBatchBlock(appSource)).not.toMatch(/await|return|catch|Promise|\.then|retry/i);
    characterization.branches.push("zero-App-arguments", "undefined-return", "sync-error-identity", "no-await", "no-catch", "no-retry");
  });

  it("uses only the current App command after ordinary owner replacement", () => {
    const alpha = vi.fn<BatchCommand>(() => Promise.resolve());
    const beta = vi.fn<BatchCommand>(() => Promise.resolve());
    const first = compileAppBatch()(alpha);
    const later = compileAppBatch()(beta);
    first.downloadBatch(); later.downloadBatch();
    expect(alpha).toHaveBeenCalledTimes(1); expect(beta).toHaveBeenCalledTimes(1);
    expect(alpha.mock.calls[0]).toHaveLength(0); expect(beta.mock.calls[0]).toHaveLength(0);
    characterization.branches.push("owner-replacement", "current-command-only", "no-stale-command");
  });

  it("keeps capability gating in desktop/mobile Selection Details and sends no disabled action", () => {
    const disabled = vi.fn(); render(createElement(SelectionDetailsStage, stageProps({ onDownloadBatchSelection: disabled })));
    const desktop = screen.getByRole("button", { name: /^Download selected$/i }); expect(desktop).toBeDisabled(); fireEvent.click(desktop); expect(disabled).not.toHaveBeenCalled(); cleanup();
    const mobile = vi.fn(); render(createElement(SelectionDetailsStage, stageProps({ showMobileBatchBar: true, onDownloadBatchSelection: mobile })));
    const mobileButton = screen.getByRole("button", { name: /^Download$/i }); expect(mobileButton).toBeDisabled(); fireEvent.click(mobileButton); expect(mobile).not.toHaveBeenCalled(); cleanup();
    const enabled = vi.fn(); render(createElement(SelectionDetailsStage, stageProps({ canDownloadBatchSelection: true, onDownloadBatchSelection: enabled })));
    fireEvent.click(screen.getByRole("button", { name: /^Download selected$/i })); expect(enabled).toHaveBeenCalledTimes(1);
    characterization.branches.push("desktop-disabled", "mobile-disabled", "enabled-dispatch-once", "capability-owner-ui-only");
  });

  it("routes zero, one-file, folder, and ordered multi selections through Download ownership", async () => {
    const context = createOperationContextToken();
    const run = async (entries: readonly FileEntry[], canDownloadBatch = true) => {
      const ports = makePorts();
      const { result } = renderHook(() => useDownload({ canOperate: () => true, canDownloadFocused: () => true, canDownloadBatch: () => canDownloadBatch, hasSession: () => true, isCacheOnlyBlocked: () => false, isOffline: () => false, buildFocusedInput: () => ({ accountId: "alpha", context }), buildBatchInput: () => ({ accountId: "alpha", accountName: "Alpha", context }), getBatchEntries: () => entries, getBatchArchiveInput: () => ({ roots: entries.map((item) => ({ entry: item, archiveRoot: item.path })), archiveLabel: "selection" }), resolveDisplayPath: (path) => `/${path}`, ports }));
      await result.current.downloadBatch(); return ports;
    };
    const zero = await run([], false); expect(zero.batch.downloadSelectionAsZip).not.toHaveBeenCalled();
    const one = await run([entry("one.txt")]); expect(one.files.prepareDownload).toHaveBeenCalledWith("one.txt", expect.any(Object)); expect(one.batch.downloadSelectionAsZip).not.toHaveBeenCalled();
    const folder = await run([entry("Archive", true)]); expect(folder.batch.downloadSelectionAsZip).toHaveBeenCalledTimes(1);
    const multi = [entry("b.txt"), entry("Archive", true), entry("a.txt")]; const ordered = await run(multi); const options = vi.mocked(ordered.batch.downloadSelectionAsZip).mock.calls[0]?.[0];
    expect(options?.roots.map(({ entry: selected }) => selected.path)).toEqual(["b.txt", "Archive", "a.txt"]);
    characterization.branches.push("zero-entry-policy-no-op", "one-file-focused-delegation", "one-folder-archive", "ordered-multi-archive", "routing-owner-download-feature");
  });

  it("clones the committed workspace selection and keeps Alpha1 -> Beta -> Alpha2 current", async () => {
    const context = createOperationContextToken(); const originalOne = entry("Alpha/one.txt"); const originalTwo = entry("Alpha/two.txt");
    const selection = { entries: [originalOne, originalTwo], archiveInput: { roots: [{ entry: originalOne, archiveRoot: "one.txt" }, { entry: originalTwo, archiveRoot: "two.txt" }], archiveLabel: "alpha" } };
    const current = { accountId: "alpha", accountName: "Alpha", token: "alpha-token", operationContextToken: context, cacheOnlyMode: false, offline: false, hasSession: () => true };
    const ports = makePorts(); const input: UseDownloadWorkspaceInput = { current, selection, policy: { canOperate: () => true, canDownloadFocused: () => true, canDownloadBatch: () => true }, resolveDisplayPath: (path: string) => `/${path}`, ports };
    const { result, rerender } = renderHook((value: UseDownloadWorkspaceInput) => useDownloadWorkspace(value), { initialProps: input });
    originalOne.path = "mutated.txt"; selection.archiveInput.archiveLabel = "mutated";
    await result.current.commands.downloadBatch();
    const options = vi.mocked(ports.batch.downloadSelectionAsZip).mock.calls[0]?.[0]; expect(options?.roots.map(({ entry: selected }) => selected.path)).toEqual(["Alpha/one.txt", "Alpha/two.txt"]); expect(options?.archiveLabel).toBe("alpha");
    const betaEntry = entry("Beta/new.txt");
    const beta = { ...input, current: { ...current, accountId: "beta", accountName: "Beta" }, selection: { entries: [betaEntry], archiveInput: { roots: [{ entry: betaEntry, archiveRoot: "new.txt" }], archiveLabel: "beta" } } };
    rerender(beta); const alpha2Entry = entry("Alpha/return.txt"); const alpha2Second = entry("Alpha/return-two.txt"); const alpha2 = { ...beta, current: { ...current, accountId: "alpha", accountName: "Alpha 2" }, selection: { entries: [alpha2Entry, alpha2Second], archiveInput: { roots: [{ entry: alpha2Entry, archiveRoot: "return.txt" }, { entry: alpha2Second, archiveRoot: "return-two.txt" }], archiveLabel: "alpha-2" } } }; rerender(alpha2);
    await result.current.commands.downloadBatch(); const calls = vi.mocked(ports.batch.downloadSelectionAsZip).mock.calls; expect(calls.at(-1)?.[0].roots[0]?.entry.path).toBe("Alpha/return.txt"); expect(calls.at(-1)?.[0].archiveLabel).toBe("alpha-2");
    characterization.branches.push("workspace-clone", "archive-snapshot", "Alpha1-to-Beta", "Beta-to-Alpha2", "stale-generation-isolation", "later-command-currentness");
  });

  it("keeps bridge effects and resource ownership out of App/Selection", () => {
    assertBridgeNeutral(appSource, projectorSource); assertDownloadOwner(downloadWorkspaceSource, downloadWorkspacePortsSource, downloadUseSource, downloadOrchestrationSource);
    expect(selectionPortsSource).toContain("downloadBatch: () => void;"); expect(downloadOrchestrationSource).toContain("ports.files.triggerBrowserDownload"); expect(downloadOrchestrationSource).toContain("scope.release();");
    characterization.branches.push("no-selection-effect", "no-chrome-effect", "no-offline-effect", "no-session-effect", "no-request-owner", "no-abort-owner", "no-transfer-owner", "no-resource-leak");
  });

  it("keeps batch, focused, Header, Preview, offline, and public feature boundaries distinct", () => {
    assertBrowseSibling(browsingBindingsSource); expect(browsingBindingsSource).not.toContain("downloadFocused"); expect(projectorSource).toContain(projectorBatchLine); expect(projectorBatchBlock(projectorSource)).not.toContain("input.commands.downloadFocused"); expect(downloadWorkspaceSource).not.toContain("projectSelectionWorkspacePresentation"); expect(selectionPortsSource).not.toMatch(/features\/operations\/download|useDownload/);
    characterization.branches.push("batch-focused-distinct", "batch-Header-distinct", "preview-distinct", "offline-distinct", "public-port-only");
  });

  it("rejects all causal provider, routing, snapshot, capability, error, effect, and dependency mutants", () => {
    const mutants: readonly [string, () => void][] = [
      ["missing-App-provider", () => assertAppBatch(replaceOnce(appSource, appBatchLine, "downloadBatchWrong: () => { void operationWorkspace.download.downloadBatch(); },"))],
      ["duplicate-App-provider", () => assertAppBatch(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      ${appBatchLine}`))],
      ["focused-App-route", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadFocused(\"wrong\", \"wrong\");"))],
      ["argument-bearing-App-route", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadBatch(batchSelectionEntries);"))],
      ["awaited-App-route", () => assertAppBatch(replaceOnce(appSource, "{ void operationWorkspace.download.downloadBatch(); }", "async () => { await operationWorkspace.download.downloadBatch(); }"))],
      ["returned-App-route", () => assertAppBatch(replaceOnce(appSource, "{ void operationWorkspace.download.downloadBatch(); }", "() => { return operationWorkspace.download.downloadBatch(); }"))],
      ["caught-App-route", () => assertAppBatch(replaceOnce(appSource, "{ void operationWorkspace.download.downloadBatch(); }", "() => { try { void operationWorkspace.download.downloadBatch(); } catch { return; } }"))],
      ["retried-App-route", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadBatch(); void operationWorkspace.download.downloadBatch();"))],
      ["entries-App-capture", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadBatch(batchSelection.entries);"))],
      ["archive-App-capture", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadBatch(batchSelection.archiveInput);"))],
      ["missing-projector-consumer", () => assertProjector(replaceOnce(projectorSource, projectorBatchLine, "onDownloadBatchSelection: () => undefined,"))],
      ["duplicate-projector-consumer", () => assertProjector(replaceOnce(projectorSource, projectorBatchLine, `${projectorBatchLine}\n${projectorBatchLine}`))],
      ["wrapped-projector-consumer", () => assertProjector(replaceOnce(projectorSource, projectorBatchLine, "onDownloadBatchSelection: () => input.commands.downloadBatch(),"))],
      ["focused-projector-consumer", () => assertProjector(replaceOnce(projectorSource, projectorBatchLine, "onDownloadBatchSelection: input.commands.downloadFocused,"))],
      ["capability-inversion", () => assertStage(replaceOnce(stageSource, "disabled={!props.canDownloadBatchSelection}", "disabled={props.canDownloadBatchSelection}"))],
      ["capability-bypass", () => assertStage(replaceOnce(stageSource, "disabled={!props.canDownloadBatchSelection}", ""))],
      ["zero-entry-transport", () => expect(replaceOnce(downloadUseSource, "if (!current.canOperate() || !current.canDownloadBatch(entries.length))", "if (false)")).toContain("if (!current.canOperate() || !current.canDownloadBatch(entries.length))")],
      ["one-file-forced-archive", () => expect(replaceOnce(downloadUseSource, "await downloadFocused(entry.path, current.resolveDisplayPath(entry.path));", "await runBatchDownloadOrchestration({ entries } as never);")).toContain("await downloadFocused(entry.path, current.resolveDisplayPath(entry.path));")],
      ["folder-focused-route", () => expect(replaceOnce(downloadOrchestrationSource, "ports.batch.downloadSelectionAsZip({", "ports.files.prepareDownload(")).toContain("ports.batch.downloadSelectionAsZip({")],
      ["multi-focused-route", () => expect(replaceOnce(downloadOrchestrationSource, "ports.batch.downloadSelectionAsZip({", "ports.files.prepareDownload(")).toContain("ports.batch.downloadSelectionAsZip({")],
      ["snapshot-clone-omitted", () => expect(replaceOnce(downloadWorkspaceSource, "selection: captureSelection(input.selection),", "selection: input.selection,")).toContain("selection: captureSelection(input.selection),")],
      ["stale-generation-command", () => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadBatch(); void operationWorkspace.download.downloadBatch();"))],
      ["Header-route-substitution", () => assertBrowseSibling(replaceOnce(browsingBindingsSource, "operation.download.downloadBatch()", "operation.download.downloadFocused()"))],
      ["direct-selection-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      batchSelection.clear();`), projectorSource)],
      ["direct-chrome-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      chromeSurfaces.openChrome(\"transfers\");`), projectorSource)],
      ["direct-offline-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      void openOfflineSyncDialog();`), projectorSource)],
      ["direct-session-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      accountActionsBridgeRef.current.resetSession(\"x\", false);`), projectorSource)],
      ["direct-network-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      void fetch(\"/download\");`), projectorSource)],
      ["direct-resource-effect", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      window.addEventListener(\"download\", () => undefined);`), projectorSource)],
      ["download-internal-import", () => assertPublicDirection(`${projectorSource}\nimport { useDownload } from \"../../download/useDownload\";`, selectionPortsSource)],
      ["workspace-request-bypass", () => assertDownloadOwner(replaceOnce(downloadWorkspaceSource, "const commands = useDownload(childInput);", "const commands = { downloadBatch: async () => undefined };"), downloadWorkspacePortsSource, downloadUseSource, downloadOrchestrationSource)],
      ["orchestration-resource-bypass", () => expect(replaceOnce(downloadUseSource, "await runBatchDownloadOrchestration({", "await ports.files.prepareDownload({")).toContain("await runBatchDownloadOrchestration({")],
      ["selection-archive-reconstruction", () => expect(replaceOnce(downloadWorkspaceSource, "getBatchArchiveInput: () => snapshot.selection.archiveInput,", "getBatchArchiveInput: () => undefined,")).toContain("getBatchArchiveInput: () => snapshot.selection.archiveInput,")],
      ["archive-order-drift", () => expect(replaceOnce(selectorsSource, "return state.memberships.map((membership) => ({ ...membership.descriptor }));", "return [...state.memberships].reverse() as never;")).toContain("return state.memberships.map((membership) => ({ ...membership.descriptor }));")],
      ["direct-transport", () => assertBridgeNeutral(replaceOnce(appSource, appBatchLine, `${appBatchLine}\n      void operationWorkspace.download.ports;`), projectorSource)]
    ];
    expect(mutants.length).toBeGreaterThanOrEqual(35);
    for (const [name, assertion] of mutants) { expect(assertion, name).toThrow(); characterization.adversaries.push(name); }
  });

  if (process.env.DAVORA_APP_BATCH_SELECTION_DOWNLOAD_FAILING_FIRST === "1") {
    it("failing-first sentinel rejects a deliberately focused-routed batch App adapter", () => {
      expect(() => assertAppBatch(replaceOnce(appSource, "void operationWorkspace.download.downloadBatch();", "void operationWorkspace.download.downloadFocused(\"wrong\", \"wrong\");"))).not.toThrow();
    });
  }

  afterAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, "characterization-summary.md"), ["App batch Selection -> Operations Download bridge Gate 1 characterization", `characterization-source-sha256=${sha256(read(characterizationPath))}`, `application-presentation-source-sha256=${sha256(read(applicationPresentationPath))}`, `download-workspace-source-sha256=${sha256(read(downloadWorkspacePath))}`, `download-use-source-sha256=${sha256(read(downloadUsePath))}`, `branches=${characterization.branches.join(",")}`, `adversaries=${characterization.adversaries.join(",")}`].join("\n") + "\n");
    writeFileSync(resolve(evidenceDir, "branch-ledger.tsv"), ["branch", ...characterization.branches].join("\n") + "\n");
    writeFileSync(resolve(evidenceDir, "adversary-ledger.tsv"), ["adversary", ...characterization.adversaries].join("\n") + "\n");
  });
});
