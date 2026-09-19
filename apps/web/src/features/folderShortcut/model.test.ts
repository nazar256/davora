import { describe, expect, it } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  buildFolderDeepLink,
  buildFolderShortcutManifest,
  buildFolderShortcutTarget,
  folderShortcutInstallAcceptedMessage,
  folderShortcutLinkCopiedMessage,
  installOutcomeStatusMessage,
  installStateAfterOutcome,
  serializeFolderShortcutManifest,
  FOLDER_SHORTCUT_COPY_FAILED_MESSAGE,
  FOLDER_SHORTCUT_INSTALL_DISMISSED_MESSAGE,
  FOLDER_SHORTCUT_INSTALL_UNAVAILABLE_MESSAGE,
  type FolderShortcutTarget
} from "./model";

const folderEntry = (path: string, name: string): FileEntry => ({ path, name, isFolder: true });
const fileEntry = (path: string, name: string): FileEntry => ({ path, name, isFolder: false });

const target: FolderShortcutTarget = {
  path: "Projects/Plans",
  name: "Plans",
  accountId: "account-alpha",
  accountName: "Alpha Cloud"
};

describe("buildFolderShortcutTarget", () => {
  it("builds a target for a folder under a connected account", () => {
    expect(buildFolderShortcutTarget(folderEntry("Projects/Plans", "Plans"), "account-alpha", "Alpha Cloud"))
      .toEqual(target);
  });

  it("refuses files and missing accounts", () => {
    expect(buildFolderShortcutTarget(fileEntry("Projects/report.pdf", "report.pdf"), "account-alpha", "Alpha Cloud"))
      .toBeUndefined();
    expect(buildFolderShortcutTarget(folderEntry("Projects/Plans", "Plans"), undefined, "Alpha Cloud"))
      .toBeUndefined();
    expect(buildFolderShortcutTarget(folderEntry("Projects/Plans", "Plans"), "", "Alpha Cloud"))
      .toBeUndefined();
  });
});

describe("buildFolderDeepLink", () => {
  it("carries the normalized folder path and account id in the URL", () => {
    const link = buildFolderDeepLink("https://davora.example/", target);

    expect(link).toBe("https://davora.example/?path=Projects%2FPlans&account=account-alpha");
  });

  it("drops stale query params from the base URL", () => {
    const link = buildFolderDeepLink("https://davora.example/?path=Old&account=account-beta&other=1", target);

    const url = new URL(link);
    expect(url.searchParams.get("path")).toBe("Projects/Plans");
    expect(url.searchParams.get("account")).toBe("account-alpha");
    expect(url.searchParams.get("other")).toBe("1");
  });

  it("never serializes credentials into the link", () => {
    const link = buildFolderDeepLink("https://davora.example/", target);

    expect(link).not.toMatch(/token|password|secret|credential/i);
  });
});

describe("buildFolderShortcutManifest", () => {
  it("uses the deep link as id and start_url so each folder installs distinctly", () => {
    const link = buildFolderDeepLink("https://davora.example/", target);
    const manifest = buildFolderShortcutManifest(target, link);

    expect(manifest.id).toBe(link);
    expect(manifest.start_url).toBe(link);
    expect(manifest.scope).toBe("https://davora.example/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.short_name).toBe("Plans");
    expect(manifest.name).toContain("Plans");
    expect(manifest.name).toContain("Alpha Cloud");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("uses absolute URLs for scope and icons so a blob-hosted manifest stays valid", () => {
    const link = buildFolderDeepLink("https://davora.example/", target);
    const manifest = buildFolderShortcutManifest(target, link);

    expect(manifest.icons.every((icon) => icon.src.startsWith("https://davora.example/"))).toBe(true);
  });

  it("serializes to JSON containing only safe display metadata", () => {
    const link = buildFolderDeepLink("https://davora.example/", target);
    const serialized = serializeFolderShortcutManifest(buildFolderShortcutManifest(target, link));

    expect(JSON.parse(serialized)).toMatchObject({ id: link, start_url: link });
    expect(serialized).not.toMatch(/token|password|secret|credential/i);
  });
});

describe("install outcome mapping", () => {
  it("maps prompt outcomes to install states", () => {
    expect(installStateAfterOutcome("accepted")).toBe("accepted");
    expect(installStateAfterOutcome("dismissed")).toBe("declined");
    expect(installStateAfterOutcome("unavailable")).toBe("unavailable");
  });

  it("maps outcomes to user-facing status messages", () => {
    expect(installOutcomeStatusMessage("accepted", "Plans")).toBe(folderShortcutInstallAcceptedMessage("Plans"));
    expect(installOutcomeStatusMessage("dismissed", "Plans")).toBe(FOLDER_SHORTCUT_INSTALL_DISMISSED_MESSAGE);
    expect(installOutcomeStatusMessage("unavailable", "Plans")).toBe(FOLDER_SHORTCUT_INSTALL_UNAVAILABLE_MESSAGE);
  });
});

describe("status message builders", () => {
  it("explains the manual home-screen path after copying", () => {
    expect(folderShortcutLinkCopiedMessage("Plans")).toContain("Plans");
    expect(folderShortcutLinkCopiedMessage("Plans")).toContain("home screen");
  });

  it("keeps the copy-failure message actionable", () => {
    expect(FOLDER_SHORTCUT_COPY_FAILED_MESSAGE).toContain("manually");
  });
});
