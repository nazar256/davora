import { useCallback, useEffect, useRef, useState } from "react";

import {
  isInstallAvailable,
  nextInstallStateAfterChoice,
  shouldClearNeedRefreshInDev,
  shouldShowUpdatePrompt
} from "./model";
import type { BeforeInstallPromptEvent, PwaRuntimePorts } from "./ports";

export interface PwaPromptState {
  installAvailable: boolean;
  installing: boolean;
  reloading: boolean;
  needRefresh: boolean;
  dismissUpdatePrompt(): void;
  installApp(): Promise<void>;
  reloadApp(): Promise<void>;
}

export function usePwaPromptState(ports: PwaRuntimePorts): PwaPromptState {
  const {
    needRefresh,
    setNeedRefresh,
    offlineReady,
    setOfflineReady,
    updateServiceWorker
  } = ports;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | undefined>();
  const [installing, setInstalling] = useState(false);
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const mountedRef = useRef(true);
  const reloadInFlightRef = useRef(false);
  const reloadGenerationRef = useRef(0);
  const reloadAttemptRef = useRef<{
    generation: number;
    cancelWait?: () => void;
    reloadTriggered: boolean;
    active: boolean;
  }>();
  const previousPortsRef = useRef(ports);
  const [standalone, setStandalone] = useState(() => ports.isStandalone());
  const visibleNeedRefresh = shouldShowUpdatePrompt(needRefresh);

  const {
    isStandalone,
    subscribeStandaloneChange,
    subscribeBeforeInstallPrompt,
    subscribeAppInstalled
  } = ports;

  const invalidateReloadAttempt = useCallback((attempt = reloadAttemptRef.current) => {
    if (!attempt) {
      return;
    }

    attempt.active = false;
    const cancelWait = attempt.cancelWait;
    attempt.cancelWait = undefined;
    if (reloadAttemptRef.current === attempt) {
      reloadAttemptRef.current = undefined;
      reloadGenerationRef.current += 1;
      reloadInFlightRef.current = false;
      if (mountedRef.current) {
        setReloading(false);
      }
    }
    cancelWait?.();
  }, []);

  useEffect(() => {
    const syncStandalone = () => setStandalone(isStandalone());
    syncStandalone();

    const unsubscribeStandalone = subscribeStandaloneChange(syncStandalone);
    const unsubscribeBeforeInstallPrompt = subscribeBeforeInstallPrompt((event) => {
      setInstallPrompt(event);
      setInstallPromptDismissed(false);
    });
    const unsubscribeAppInstalled = subscribeAppInstalled(() => {
      setStandalone(true);
      setInstallPrompt(undefined);
      setInstallPromptDismissed(false);
    });

    return () => {
      unsubscribeStandalone();
      unsubscribeBeforeInstallPrompt();
      unsubscribeAppInstalled();
    };
  }, [isStandalone, subscribeStandaloneChange, subscribeBeforeInstallPrompt, subscribeAppInstalled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateReloadAttempt();
    };
  }, [invalidateReloadAttempt]);

  useEffect(() => {
    if (previousPortsRef.current === ports) {
      return;
    }

    previousPortsRef.current = ports;
    invalidateReloadAttempt();
  }, [invalidateReloadAttempt, ports]);

  useEffect(() => {
    if (!offlineReady) {
      return;
    }

    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!shouldClearNeedRefreshInDev(needRefresh)) {
      return;
    }

    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh]);

  const installAvailable = isInstallAvailable(Boolean(installPrompt), installPromptDismissed, standalone);

  const installApp = async () => {
    if (!installPrompt) {
      return;
    }

    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      const nextState = nextInstallStateAfterChoice(choice.outcome);
      if (nextState.clearPrompt) {
        setInstallPrompt(undefined);
      }
      setInstallPromptDismissed(nextState.dismissed);
    } catch {
      setInstallPromptDismissed(true);
    } finally {
      setInstalling(false);
    }
  };

  const reloadApp = async () => {
    if (reloadInFlightRef.current || !mountedRef.current) {
      return;
    }

    const previousAttempt = reloadAttemptRef.current;
    if (previousAttempt) {
      invalidateReloadAttempt(previousAttempt);
    }

    const attempt = {
      generation: reloadGenerationRef.current + 1,
      cancelWait: undefined as (() => void) | undefined,
      reloadTriggered: false,
      active: true
    };
    reloadGenerationRef.current = attempt.generation;
    reloadAttemptRef.current = attempt;
    reloadInFlightRef.current = true;
    setReloading(true);

    try {
      // Armed wait owns reload via controllerchange or the 1500ms fallback.
      // Post-await reload only when no service worker wait could be armed (parity with retired ReloadPrompt).
      const onReady = () => {
        if (
          !mountedRef.current
          || reloadAttemptRef.current !== attempt
          || reloadGenerationRef.current !== attempt.generation
          || !attempt.active
          || attempt.reloadTriggered
        ) {
          return;
        }

        attempt.reloadTriggered = true;
        const cancelWait = attempt.cancelWait;
        attempt.cancelWait = undefined;
        cancelWait?.();
        ports.reloadWindow();
      };
      const cancelWait = ports.waitForControllerChangeOrTimeout(1500, onReady);
      if (cancelWait !== undefined) {
        if (
          mountedRef.current
          && reloadAttemptRef.current === attempt
          && reloadGenerationRef.current === attempt.generation
          && attempt.active
          && !attempt.reloadTriggered
        ) {
          attempt.cancelWait = cancelWait;
        } else {
          cancelWait();
        }
      }

      await updateServiceWorker(true);

      if (
        cancelWait === undefined
        && mountedRef.current
        && reloadAttemptRef.current === attempt
        && attempt.active
        && !attempt.reloadTriggered
      ) {
        attempt.reloadTriggered = true;
        ports.reloadWindow();
      }
    } catch (error) {
      invalidateReloadAttempt(attempt);
      throw error;
    } finally {
      if (reloadAttemptRef.current === attempt) {
        reloadInFlightRef.current = false;
        if (mountedRef.current) {
          setReloading(false);
        }
      }
    }
  };

  return {
    installAvailable,
    installing,
    reloading,
    needRefresh: visibleNeedRefresh,
    dismissUpdatePrompt: () => setNeedRefresh(false),
    installApp,
    reloadApp
  };
}
