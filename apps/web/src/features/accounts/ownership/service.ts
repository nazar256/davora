import type { BrowserOwnershipIdentity } from "./model";
import { BrowserOwnershipUnavailableError } from "./model";
import type { BrowserOwnershipEnvironmentPort, BrowserOwnershipStoragePort } from "./ports";

const ID_KEY = "davora-browser-id" as const;
const SECRET_KEY = "davora-browser-secret" as const;

export interface BrowserOwnershipIdentityService {
  read(): BrowserOwnershipIdentity;
}

export function createBrowserOwnershipIdentityService(input: {
  readonly storage: BrowserOwnershipStoragePort;
  readonly environment: BrowserOwnershipEnvironmentPort;
}): BrowserOwnershipIdentityService {
  return {
    read() {
      const idResult = input.storage.read(ID_KEY);
      const secretResult = input.storage.read(SECRET_KEY);
      if (idResult.kind !== "value" || secretResult.kind !== "value") {
        throw new BrowserOwnershipUnavailableError("storage-read");
      }

      const storedId = idResult.value;
      const storedSecret = secretResult.value;
      const id = storedId === null || storedId === ""
        ? undefined
        : input.environment.canonicalizeHeaderValue(storedId);
      const secret = storedSecret === null || storedSecret === ""
        ? undefined
        : input.environment.canonicalizeHeaderValue(storedSecret);
      if ((storedId !== null && storedId !== "" && !id)
        || (storedSecret !== null && storedSecret !== "" && !secret)) {
        throw new BrowserOwnershipUnavailableError("invalid-existing");
      }

      const generatedId = id ? undefined : input.environment.createSecureToken();
      const generatedSecret = secret ? undefined : input.environment.createSecureToken();
      if ((!id && !generatedId) || (!secret && !generatedSecret)) {
        throw new BrowserOwnershipUnavailableError("secure-random-unavailable");
      }

      const finalId = id ?? generatedId!;
      const finalSecret = secret ?? generatedSecret!;
      if (!id) {
        if (input.storage.write(ID_KEY, finalId).kind !== "written") {
          throw new BrowserOwnershipUnavailableError("storage-write");
        }
      }
      if (!secret) {
        if (input.storage.write(SECRET_KEY, finalSecret).kind !== "written") {
          throw new BrowserOwnershipUnavailableError("storage-write");
        }
      }
      return { browserId: finalId, browserSecret: finalSecret };
    }
  };
}
