import type { InstallOutcome } from "./model";

export type InstallChoice = { outcome: InstallOutcome; platform?: string };

export interface BeforeInstallPromptEvent {
  readonly platforms?: readonly string[];
  readonly userChoice: Promise<InstallChoice>;
  prompt(): Promise<void>;
  preventDefault(): void;
}

export interface PwaUpdatePorts {
  readonly needRefresh: boolean;
  readonly setNeedRefresh: (value: boolean) => void;
  readonly offlineReady: boolean;
  readonly setOfflineReady: (value: boolean) => void;
  readonly updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export interface PwaBrowserEnvironmentPorts {
  readonly isStandalone: () => boolean;
  readonly subscribeStandaloneChange: (listener: () => void) => () => void;
  readonly subscribeBeforeInstallPrompt: (handler: (event: BeforeInstallPromptEvent) => void) => () => void;
  readonly subscribeAppInstalled: (handler: () => void) => () => void;
  readonly reloadWindow: () => void;
  readonly waitForControllerChangeOrTimeout: (delayMs: number, onReady: () => void) => (() => void) | undefined;
}

export type PwaRuntimePorts = PwaBrowserEnvironmentPorts & PwaUpdatePorts;
