import { useCallback, useMemo } from "react";

import { applyAccountSessionMutation } from "../session/controller";
import { useAccountRegistry } from "../registry";
import { projectAccountStateWorkspaceSnapshot } from "./model";
import type { AccountStateWorkspaceInput, AccountStateWorkspaceOutput } from "./ports";

export function useAccountStateWorkspace(input: AccountStateWorkspaceInput): AccountStateWorkspaceOutput {
  const registry = useAccountRegistry(input.registry);
  const snapshot = useMemo(
    () => projectAccountStateWorkspaceSnapshot(registry.state),
    [registry.state]
  );
  const sourceRecord = registry.state.snapshot.accounts.find((record) => record.account.id === snapshot.operationalActiveAccount?.id);
  const sessionAuthority = useMemo(() => ({
    capture: () => Object.freeze({
      accountId: snapshot.operationalActiveAccount?.id,
      token: sourceRecord?.session?.token,
      capabilities: sourceRecord?.session?.capabilities,
      revision: snapshot.sessionRevision
    })
  }), [snapshot, sourceRecord]);
  const switchActive = useCallback((accountId: string) => input.registry.switchAccount(accountId), [input.registry]);
  const connectAccount = useCallback((request: Parameters<AccountStateWorkspaceOutput["commands"]["connectAccount"]>[0]) => (
    input.registry.connectAccount(request, input.transport.connectAccount)
  ), [input.registry, input.transport.connectAccount]);
  const removeAccount = useCallback((accountId: string, ports: Parameters<AccountStateWorkspaceOutput["commands"]["removeAccount"]>[1]) => (
    input.registry.removeAccount(accountId, ports)
  ), [input.registry]);
  const retryRemovalCommit = useCallback((retryToken: string) => input.registry.retryRemovalCommit(retryToken), [input.registry]);
  const applyTerminal = useCallback((accountId: string, reconnectRequired: boolean) => {
    applyAccountSessionMutation(input.session, reconnectRequired
      ? { kind: "reconnect-required", accountId }
      : { kind: "clear-session", accountId });
  }, [input.session]);

  const commands = useMemo(() => ({
    switchActive,
    connectAccount,
    removeAccount,
    retryRemovalCommit,
    applyTerminal
  }), [applyTerminal, connectAccount, removeAccount, retryRemovalCommit, switchActive]);

  return { snapshot, commands, sessionAuthority };
}
