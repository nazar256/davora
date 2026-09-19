type BrowserConnectivitySnapshot = { readonly kind: "online" } | { readonly kind: "offline" };
type BrowserConnectivityListener = (snapshot: BrowserConnectivitySnapshot) => void;

const ONLINE_SNAPSHOT: BrowserConnectivitySnapshot = { kind: "online" };
const OFFLINE_SNAPSHOT: BrowserConnectivitySnapshot = { kind: "offline" };

export function createBrowserConnectivityPort() {
  const read = (): BrowserConnectivitySnapshot => navigator.onLine ? ONLINE_SNAPSHOT : OFFLINE_SNAPSHOT;

  return {
    read,
    subscribe: (listener: BrowserConnectivityListener) => {
      const onOnline = () => listener(ONLINE_SNAPSHOT);
      const onOffline = () => listener(OFFLINE_SNAPSHOT);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }
  };
}
