import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";
import type { InstallOutcome } from "../pwa";

import type { FolderShortcutPorts } from "./ports";
import { useFolderShortcut, type FolderShortcutWorkspaceInput } from "./useFolderShortcut";

const folderEntry = (path: string, name: string): FileEntry => ({ path, name, isFolder: true });
const fileEntry = (path: string, name: string): FileEntry => ({ path, name, isFolder: false });

function createPorts(overrides: Partial<FolderShortcutPorts> = {}) {
  const port: FolderShortcutPorts = {
    clipboard: { writeText: vi.fn(async () => true) },
    manifestLink: { attachManifest: vi.fn(() => vi.fn()) },
    installCapture: {
      isAvailable: vi.fn(() => true),
      claim: vi.fn(),
      release: vi.fn(),
      prompt: vi.fn(async (): Promise<InstallOutcome | "unavailable"> => "accepted")
    },
    navigation: {
      getBaseHref: vi.fn(() => "https://davora.example/?path=Projects&account=account-alpha"),
      pushFolderShortcutSurface: vi.fn()
    },
    presentation: { setStatus: vi.fn() },
    ...overrides
  };
  return port;
}

function renderShortcut(
  ports: FolderShortcutPorts,
  account: FolderShortcutWorkspaceInput["account"] = { id: "account-alpha", name: "Alpha Cloud" },
  experimentalAppShortcutEnabled = true
) {
  return renderHook(
    ({ accountId, enabled }: { accountId: string | undefined; enabled: boolean }) =>
      useFolderShortcut({
        account: { id: accountId, name: account.name },
        experimentalAppShortcutEnabled: enabled,
        ports
      }),
    { initialProps: { accountId: account.id, enabled: experimentalAppShortcutEnabled } }
  );
}

describe("useFolderShortcut", () => {
  it("opens the dialog with a stable account-aware deep link and pushes the surface", () => {
    const ports = createPorts();
    const { result } = renderShortcut(ports);

    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    expect(result.current.bridge.isOpen()).toBe(true);
    expect(result.current.bridge.snapshot()).toMatchObject({
      open: true,
      link: "https://davora.example/?path=Projects%2FPlans&account=account-alpha",
      linkCopied: false,
      install: "idle"
    });
    expect(result.current.bridge.snapshot().target).toMatchObject({
      path: "Projects/Plans",
      name: "Plans",
      accountId: "account-alpha"
    });
    expect(ports.navigation.pushFolderShortcutSurface).toHaveBeenCalledTimes(1);
  });

  it("ignores non-folder entries", () => {
    const ports = createPorts();
    const { result } = renderShortcut(ports);

    act(() => result.current.commands.open(fileEntry("Projects/report.pdf", "report.pdf")));

    expect(result.current.bridge.isOpen()).toBe(false);
    expect(ports.navigation.pushFolderShortcutSurface).not.toHaveBeenCalled();
  });

  it("reports instead of opening when no account is connected", () => {
    const ports = createPorts();
    const { result } = renderShortcut(ports, { id: undefined, name: "" });

    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    expect(result.current.bridge.isOpen()).toBe(false);
    expect(ports.presentation.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Connect an account")
    );
  });

  it("copies the link, marks it copied, and announces the manual hint", async () => {
    const ports = createPorts();
    const { result } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => { result.current.stage.onCopyLink(); });

    const link = "https://davora.example/?path=Projects%2FPlans&account=account-alpha";
    expect(ports.clipboard.writeText).toHaveBeenCalledWith(link);
    expect(result.current.bridge.snapshot().linkCopied).toBe(true);
    expect(ports.presentation.setStatus).toHaveBeenCalledWith(expect.stringContaining("home screen"));
  });

  it("announces a manual fallback when the clipboard write fails", async () => {
    const ports = createPorts({
      clipboard: { writeText: vi.fn(async () => false) }
    });
    const { result } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => { result.current.stage.onCopyLink(); });

    expect(result.current.bridge.snapshot().linkCopied).toBe(false);
    expect(ports.presentation.setStatus).toHaveBeenCalledWith(expect.stringContaining("manually"));
  });

  it("claims the install capture, attaches a folder manifest, and releases both after install", async () => {
    const restoreManifest = vi.fn();
    const ports = createPorts({
      manifestLink: { attachManifest: vi.fn(() => restoreManifest) }
    });
    const { result } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => { result.current.stage.onInstallAsApp(); });

    expect(ports.installCapture.claim).toHaveBeenCalledWith("folder-shortcut");
    expect(ports.manifestLink.attachManifest).toHaveBeenCalledTimes(1);
    const manifestJson = vi.mocked(ports.manifestLink.attachManifest).mock.calls[0][0];
    const manifest: unknown = JSON.parse(manifestJson);
    expect(manifest).toMatchObject({
      id: "https://davora.example/?path=Projects%2FPlans&account=account-alpha",
      start_url: "https://davora.example/?path=Projects%2FPlans&account=account-alpha",
      short_name: "Plans"
    });
    expect(ports.installCapture.prompt).toHaveBeenCalledWith("folder-shortcut");
    expect(restoreManifest).toHaveBeenCalledTimes(1);
    expect(ports.installCapture.release).toHaveBeenCalledTimes(1);
    expect(result.current.bridge.snapshot().install).toBe("accepted");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith(expect.stringContaining("installed"));
  });

  it("does not run the app install flow when the experimental flag is off", async () => {
    const ports = createPorts();
    const { result } = renderShortcut(ports, { id: "account-alpha", name: "Alpha Cloud" }, false);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => { result.current.stage.onInstallAsApp(); });

    expect(ports.installCapture.claim).not.toHaveBeenCalled();
    expect(ports.manifestLink.attachManifest).not.toHaveBeenCalled();
    expect(result.current.bridge.snapshot().install).toBe("idle");
  });

  it("marks install unavailable and explains the fallback when no prompt is captured", async () => {
    const ports = createPorts({
      installCapture: {
        isAvailable: vi.fn(() => false),
        claim: vi.fn(),
        release: vi.fn(),
        prompt: vi.fn(async (): Promise<InstallOutcome | "unavailable"> => "unavailable")
      }
    });
    const { result } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => { result.current.stage.onInstallAsApp(); });

    expect(result.current.bridge.snapshot().install).toBe("unavailable");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith(expect.stringContaining("Add to Home screen"));
  });

  it("cancels an in-flight install on dismiss and ignores its late outcome", async () => {
    const restoreManifest = vi.fn();
    let resolvePrompt: ((outcome: InstallOutcome | "unavailable") => void) | undefined;
    const ports = createPorts({
      manifestLink: { attachManifest: vi.fn(() => restoreManifest) },
      installCapture: {
        isAvailable: vi.fn(() => true),
        claim: vi.fn(),
        release: vi.fn(),
        prompt: vi.fn(() => new Promise<InstallOutcome | "unavailable">((resolve) => { resolvePrompt = resolve; }))
      }
    });
    const { result } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => {
      result.current.stage.onInstallAsApp();
      await Promise.resolve();
    });
    expect(result.current.bridge.snapshot().install).toBe("requesting");

    act(() => result.current.bridge.dismiss());
    expect(result.current.bridge.isOpen()).toBe(false);
    expect(restoreManifest).toHaveBeenCalledTimes(1);
    expect(ports.installCapture.release).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePrompt?.("accepted");
      await Promise.resolve();
    });
    expect(result.current.bridge.isOpen()).toBe(false);
    expect(ports.presentation.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("installed"));
  });

  it("dismisses the dialog when the active account changes", () => {
    const ports = createPorts();
    const { result, rerender } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));
    expect(result.current.bridge.isOpen()).toBe(true);

    rerender({ accountId: "account-beta", enabled: true });

    expect(result.current.bridge.isOpen()).toBe(false);
  });

  it("restores the manifest and releases the capture on unmount mid-install", async () => {
    const restoreManifest = vi.fn();
    const ports = createPorts({
      manifestLink: { attachManifest: vi.fn(() => restoreManifest) },
      installCapture: {
        isAvailable: vi.fn(() => true),
        claim: vi.fn(),
        release: vi.fn(),
        prompt: vi.fn(() => new Promise<InstallOutcome | "unavailable">(() => undefined))
      }
    });
    const { result, unmount } = renderShortcut(ports);
    act(() => result.current.commands.open(folderEntry("Projects/Plans", "Plans")));

    await act(async () => {
      void result.current.stage.onInstallAsApp();
      await Promise.resolve();
    });

    unmount();
    expect(restoreManifest).toHaveBeenCalledTimes(1);
    expect(ports.installCapture.release).toHaveBeenCalled();
  });
});
