import { useRef } from "react";

import type { AppServices } from "./app/AppServices";
import { AppShell } from "./app/AppShell";
import { resolveAppServices } from "./app/resolveAppServices";
import { useBrowserWorkspaceComposition } from "./app/useBrowserWorkspaceComposition";

export interface AppProps {
  services?: AppServices;
}

export default function App({ services: providedServices }: AppProps = {}) {
  const fallbackServices = useRef<AppServices | undefined>(undefined);
  const services = resolveAppServices(providedServices, fallbackServices);
  const appShell = useBrowserWorkspaceComposition(services);
  return <AppShell {...appShell} />;
}
