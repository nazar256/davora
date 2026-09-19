import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { toDisplayPath, type FileEntry } from "@davora/shared";

import {
  buildFolderDeepLink,
  buildFolderShortcutManifest,
  buildFolderShortcutTarget,
  closedFolderShortcutSnapshot,
  FOLDER_SHORTCUT_COPY_FAILED_MESSAGE,
  FOLDER_SHORTCUT_MANUAL_HINT,
  FOLDER_SHORTCUT_NO_ACCOUNT_MESSAGE,
  folderShortcutLinkCopiedMessage,
  installOutcomeStatusMessage,
  installStateAfterOutcome,
  serializeFolderShortcutManifest,
  type FolderShortcutDialogSnapshot
} from "./model";
import type { FolderShortcutPorts } from "./ports";
import type { FolderShortcutStageProps } from "./FolderShortcutStage";

export interface FolderShortcutWorkspaceInput {
  readonly account: {
    readonly id: string | undefined;
    readonly name: string;
  };
  readonly experimentalAppShortcutEnabled: boolean;
  readonly ports: FolderShortcutPorts;
}

export interface FolderShortcutBridge {
  snapshot(): FolderShortcutDialogSnapshot;
  isOpen(): boolean;
  dismiss(): void;
}

export interface FolderShortcutWorkspace {
  readonly bridge: FolderShortcutBridge;
  readonly commands: {
    readonly open: (entry: FileEntry) => void;
  };
  readonly stage: FolderShortcutStageProps;
}

export function useFolderShortcut(input: FolderShortcutWorkspaceInput): FolderShortcutWorkspace {
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const [dialog, setDialog] = useState<FolderShortcutDialogSnapshot>(closedFolderShortcutSnapshot);
  const dialogRef = useRef(dialog);
  const storeDialog = useCallback((next: FolderShortcutDialogSnapshot) => {
    dialogRef.current = next;
    setDialog(next);
  }, []);

  const mountedRef = useRef(true);
  const installAttemptRef = useRef<{
    active: boolean;
    restoreManifest?: () => void;
  } | undefined>();

  const cancelActiveInstall = useCallback(() => {
    const attempt = installAttemptRef.current;
    if (!attempt) {
      return;
    }
    attempt.active = false;
    installAttemptRef.current = undefined;
    attempt.restoreManifest?.();
    inputRef.current.ports.installCapture.release();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelActiveInstall();
    };
  }, [cancelActiveInstall]);

  const dismiss = useCallback(() => {
    cancelActiveInstall();
    storeDialog(closedFolderShortcutSnapshot());
  }, [cancelActiveInstall, storeDialog]);

  // A shortcut is bound to one account; a switch invalidates the open dialog.
  const accountId = input.account.id;
  useEffect(() => {
    const snapshot = dialogRef.current;
    if (snapshot.open && snapshot.target && snapshot.target.accountId !== accountId) {
      dismiss();
    }
  }, [accountId, dismiss]);

  const open = useCallback((entry: FileEntry) => {
    const current = inputRef.current;
    if (!entry.isFolder) {
      return;
    }
    const target = buildFolderShortcutTarget(entry, current.account.id, current.account.name);
    if (!target) {
      current.ports.presentation.setStatus(FOLDER_SHORTCUT_NO_ACCOUNT_MESSAGE);
      return;
    }
    cancelActiveInstall();
    const link = buildFolderDeepLink(current.ports.navigation.getBaseHref(), target);
    storeDialog({ open: true, target, link, linkCopied: false, install: "idle" });
    current.ports.navigation.pushFolderShortcutSurface();
  }, [cancelActiveInstall, storeDialog]);

  const copyLink = useCallback(async () => {
    const current = inputRef.current;
    const snapshot = dialogRef.current;
    if (!snapshot.open || !snapshot.target) {
      return;
    }
    const copied = await current.ports.clipboard.writeText(snapshot.link);
    if (!mountedRef.current) {
      return;
    }
    if (copied && dialogRef.current.open && dialogRef.current.link === snapshot.link) {
      storeDialog({ ...dialogRef.current, linkCopied: true });
    }
    current.ports.presentation.setStatus(
      copied
        ? folderShortcutLinkCopiedMessage(snapshot.target.name)
        : FOLDER_SHORTCUT_COPY_FAILED_MESSAGE
    );
  }, [storeDialog]);

  const installAsApp = useCallback(async () => {
    const current = inputRef.current;
    const snapshot = dialogRef.current;
    if (
      !current.experimentalAppShortcutEnabled
      || !snapshot.open
      || !snapshot.target
      || snapshot.install === "requesting"
    ) {
      return;
    }

    storeDialog({ ...snapshot, install: "requesting" });
    const attempt = { active: true, restoreManifest: undefined as (() => void) | undefined };
    installAttemptRef.current = attempt;

    current.ports.installCapture.claim("folder-shortcut");
    attempt.restoreManifest = current.ports.manifestLink.attachManifest(
      serializeFolderShortcutManifest(buildFolderShortcutManifest(snapshot.target, snapshot.link))
    );

    const outcome = await current.ports.installCapture.prompt("folder-shortcut");

    attempt.restoreManifest?.();
    attempt.restoreManifest = undefined;
    if (installAttemptRef.current === attempt) {
      installAttemptRef.current = undefined;
    }
    current.ports.installCapture.release();

    if (!attempt.active || !mountedRef.current) {
      return;
    }

    const latest = dialogRef.current;
    if (latest.open && latest.target === snapshot.target) {
      storeDialog({ ...latest, install: installStateAfterOutcome(outcome) });
    }
    current.ports.presentation.setStatus(installOutcomeStatusMessage(outcome, snapshot.target.name));
  }, [storeDialog]);

  return {
    bridge: {
      snapshot: () => dialogRef.current,
      isOpen: () => dialogRef.current.open,
      dismiss
    },
    commands: { open },
    stage: {
      open: dialog.open,
      folderName: dialog.target?.name ?? "",
      displayPath: dialog.target ? toDisplayPath(dialog.target.path) : "",
      accountName: dialog.target?.accountName ?? "",
      link: dialog.link,
      linkCopied: dialog.linkCopied,
      manualHint: FOLDER_SHORTCUT_MANUAL_HINT,
      appShortcutEnabled: input.experimentalAppShortcutEnabled,
      installState: dialog.install,
      onCopyLink: () => { void copyLink(); },
      onInstallAsApp: () => { void installAsApp(); },
      onClose: dismiss
    }
  };
}
