import { useEffect, useSyncExternalStore } from "react";

import { selectActiveAccountRecord } from "./model";
import type { AccountRegistryService } from "./service";

export function useAccountRegistry(service: AccountRegistryService) {
  const state = useSyncExternalStore(service.subscribe, service.getState, service.getState);
  useEffect(() => {
    service.repair();
  }, [service]);
  return {
    state,
    snapshot: state.snapshot,
    activeRecord: selectActiveAccountRecord(state.snapshot),
    service
  } as const;
}
