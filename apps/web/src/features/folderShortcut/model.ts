import type { FileEntry } from "@davora/shared";

import { buildLocationHref } from "../navigation";
import type { InstallOutcome } from "../pwa";

export interface FolderShortcutTarget {
  readonly path: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
}

export type FolderShortcutInstallState = "idle" | "requesting" | "accepted" | "declined" | "unavailable";

export interface FolderShortcutDialogSnapshot {
  readonly open: boolean;
  readonly target: FolderShortcutTarget | undefined;
  readonly link: string;
  readonly linkCopied: boolean;
  readonly install: FolderShortcutInstallState;
}

export const closedFolderShortcutSnapshot = (): FolderShortcutDialogSnapshot => Object.freeze({
  open: false,
  target: undefined,
  link: "",
  linkCopied: false,
  install: "idle"
});

export const buildFolderShortcutTarget = (
  entry: FileEntry,
  accountId: string | undefined,
  accountName: string
): FolderShortcutTarget | undefined => {
  if (!entry.isFolder || accountId === undefined || accountId === "") {
    return undefined;
  }
  return Object.freeze({
    path: entry.path,
    name: entry.name,
    accountId,
    accountName
  });
};

/** Stable account-aware deep link; only carries path + account id, never credentials. */
export const buildFolderDeepLink = (baseHref: string, target: FolderShortcutTarget): string =>
  buildLocationHref(baseHref, target.path, target.accountId);

export interface FolderShortcutManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

export const FOLDER_SHORTCUT_MANIFEST_ICONS: readonly FolderShortcutManifestIcon[] = Object.freeze([
  Object.freeze({ src: "/pwa-192.png", sizes: "192x192", type: "image/png" }),
  Object.freeze({ src: "/pwa-512.png", sizes: "512x512", type: "image/png" }),
  Object.freeze({ src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "any maskable" })
]);

export interface FolderShortcutManifest {
  readonly id: string;
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: "standalone";
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: readonly FolderShortcutManifestIcon[];
}

/**
 * Folder-specific manifest for the experimental "Shortcut as app" flow.
 * `id` is the deep link itself so every (folder, account) pair installs as a
 * distinct launcher entry. Contains no credentials or public share links.
 * All URLs are absolute because the manifest is served from a blob: URL where
 * relative references cannot resolve.
 */
export const buildFolderShortcutManifest = (
  target: FolderShortcutTarget,
  link: string
): FolderShortcutManifest => {
  const origin = new URL(link).origin;
  return Object.freeze({
    id: link,
    name: `${target.name} – ${target.accountName}`,
    short_name: target.name,
    description: `Davora folder shortcut for ${target.path} in ${target.accountName}.`,
    start_url: link,
    scope: `${origin}/`,
    display: "standalone",
    theme_color: "#07101f",
    background_color: "#07101f",
    icons: FOLDER_SHORTCUT_MANIFEST_ICONS.map((icon) => ({ ...icon, src: `${origin}${icon.src}` }))
  });
};

export const serializeFolderShortcutManifest = (manifest: FolderShortcutManifest): string =>
  JSON.stringify(manifest);

export const installStateAfterOutcome = (
  outcome: InstallOutcome | "unavailable"
): FolderShortcutInstallState =>
  outcome === "accepted" ? "accepted" : outcome === "dismissed" ? "declined" : "unavailable";

export const folderShortcutLinkCopiedMessage = (name: string): string =>
  `Folder link for ${name} copied. Open it on your device and use the browser menu to add it to your home screen.`;

export const FOLDER_SHORTCUT_COPY_FAILED_MESSAGE =
  "Could not copy the folder link. Copy it manually from the dialog.";

export const FOLDER_SHORTCUT_NO_ACCOUNT_MESSAGE =
  "Connect an account before creating a folder shortcut.";

export const folderShortcutInstallAcceptedMessage = (name: string): string =>
  `Home screen app for ${name} installed.`;

export const FOLDER_SHORTCUT_INSTALL_DISMISSED_MESSAGE =
  "Folder app install was dismissed.";

export const FOLDER_SHORTCUT_INSTALL_UNAVAILABLE_MESSAGE =
  "This browser cannot install a folder app here. Copy the folder link and use 'Add to Home screen' from the browser menu instead.";

export const FOLDER_SHORTCUT_MANUAL_HINT =
  "To add this folder to your home screen, copy the link, open it in Chrome on your Android device, then use the browser menu and choose 'Add to Home screen'.";

export const installOutcomeStatusMessage = (
  outcome: InstallOutcome | "unavailable",
  name: string
): string =>
  outcome === "accepted"
    ? folderShortcutInstallAcceptedMessage(name)
    : outcome === "dismissed"
      ? FOLDER_SHORTCUT_INSTALL_DISMISSED_MESSAGE
      : FOLDER_SHORTCUT_INSTALL_UNAVAILABLE_MESSAGE;
