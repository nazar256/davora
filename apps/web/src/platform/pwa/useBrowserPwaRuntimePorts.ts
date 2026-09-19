import { useMemo } from "react";

import { createBrowserPwaPorts, type BrowserPwaEnvironmentPorts } from "./browserPwaPorts";
import { useBrowserPwaRegistration, type BrowserPwaRegistrationState } from "./useBrowserPwaRegistration";

export type BrowserPwaRuntimePorts = BrowserPwaEnvironmentPorts & BrowserPwaRegistrationState;

export function useBrowserPwaRuntimePorts(): BrowserPwaRuntimePorts {
  const environment = useMemo(
    () => createBrowserPwaPorts(),
    []
  );
  const registration = useBrowserPwaRegistration();

  return useMemo(
    () => ({ ...environment, ...registration }),
    [environment, registration]
  );
}
