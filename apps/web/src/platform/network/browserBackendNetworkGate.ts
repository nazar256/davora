import { setBackendNetworkBlocked } from "../../lib/networkPolicy";

export function createBrowserBackendNetworkGate() {
  return {
    setBlocked(blocked: boolean): void {
      setBackendNetworkBlocked(blocked);
    }
  };
}
