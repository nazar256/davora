import type { InstallCaptureOwner, InstallOutcome } from "../pwa";

export interface FolderShortcutClipboardPort {
  writeText(text: string): Promise<boolean>;
}

export interface FolderShortcutManifestLinkPort {
  /**
   * Point the document manifest at serialized manifest JSON.
   * Returns an idempotent restore callback owned by the caller.
   */
  attachManifest(serializedManifest: string): () => void;
}

export interface FolderShortcutInstallCapturePort {
  isAvailable(): boolean;
  claim(owner: InstallCaptureOwner): void;
  release(): void;
  prompt(owner: InstallCaptureOwner): Promise<InstallOutcome | "unavailable">;
}

export interface FolderShortcutPorts {
  readonly clipboard: FolderShortcutClipboardPort;
  readonly manifestLink: FolderShortcutManifestLinkPort;
  readonly installCapture: FolderShortcutInstallCapturePort;
  readonly navigation: {
    readonly getBaseHref: () => string;
    readonly pushFolderShortcutSurface: () => void;
  };
  readonly presentation: {
    readonly setStatus: (message: string) => void;
  };
}
