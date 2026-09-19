import type { AppServices } from "./AppServices";
import { createBrowserAppServices } from "./createBrowserAppServices";

export function resolveAppServices(
  providedServices: AppServices | undefined,
  fallbackServices: { current: AppServices | undefined }
): AppServices {
  if (providedServices) {
    return providedServices;
  }
  if (!fallbackServices.current) {
    fallbackServices.current = createBrowserAppServices();
  }
  return fallbackServices.current;
}
