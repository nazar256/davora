import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAccountBootstrap } from "../bootstrap";
import type { AccountBootstrapWorkspaceInput, AccountBootstrapWorkspaceOutput } from "./ports";

export function useAccountBootstrapWorkspace(input: AccountBootstrapWorkspaceInput): AccountBootstrapWorkspaceOutput {
  const authority = input.sessionAuthority.capture();
  const authorityMatchesAccount = authority.accountId === input.account.operationalActiveAccount?.id
    && authority.revision === input.account.sessionRevision;
  const bootstrap = useAccountBootstrap({
    registryUnavailable: input.account.registryUnavailable,
    explicitOfflineMode: input.explicitOfflineMode,
    offline: input.offline,
    accountCount: input.account.accountCount,
    activeAccount: input.account.operationalActiveAccount,
    token: authorityMatchesAccount ? authority.token : undefined,
    cacheNamespace: input.account.activeCacheNamespace,
    accountHost: input.account.bootstrapSafeHost,
    ports: input.ports
  });
  const noticeKeyRef = useRef<string | undefined>();
  const registryNotice = input.account.registryNotice;
  const switchActive = useCallback((accountId: string) => {
    const outcome = input.accountCommands.switchActive(accountId);
    if (outcome.kind !== "committed") {
      input.ports.onStatusChange(outcome.message);
    }
    return outcome;
  }, [input.accountCommands, input.ports]);
  const accountCommands = useMemo(() => ({ ...input.accountCommands, switchActive }), [input.accountCommands, switchActive]);
  useEffect(() => {
    if (!registryNotice) {
      noticeKeyRef.current = undefined;
      return;
    }
    if (noticeKeyRef.current === registryNotice) {
      return;
    }
    noticeKeyRef.current = registryNotice;
    input.ports.onStatusChange(registryNotice);
  }, [input.ports, registryNotice]);

  return { ...bootstrap, account: input.account, accountCommands };
}
