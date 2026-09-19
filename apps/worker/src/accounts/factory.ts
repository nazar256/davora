import type { WorkerEnv } from "../types";
import { DurableAccountStateStorage } from "./durableAccountStorage";
import { LocalAccountStateStorage } from "./localAccountStorage";
import { createAccountRepository, type AccountRepository } from "./repository";
import { createAccountService, type AccountService } from "./service";
import type { AccountStateStorage } from "./storage";

export function createAccountStateStorage(env: WorkerEnv): AccountStateStorage {
  if (env.LOCAL_DEV_STATE_PATH) return new LocalAccountStateStorage(env.LOCAL_DEV_STATE_PATH);
  if (env.DAVORA_ACCOUNT_STORE) return new DurableAccountStateStorage(env.DAVORA_ACCOUNT_STORE);
  if (env.ACCOUNT_STATE_STORAGE) return env.ACCOUNT_STATE_STORAGE;
  throw new Error("Account state storage is not configured.");
}

export function createAccountRepositoryForEnvironment(env: WorkerEnv): AccountRepository {
  const primarySecret = env.ACCOUNT_STATE_SECRET ?? env.SESSION_SECRET;
  return createAccountRepository({
    storage: createAccountStateStorage(env),
    primarySecret,
    ...(primarySecret !== env.SESSION_SECRET ? { legacySecret: env.SESSION_SECRET } : {})
  });
}

export function createAccountServiceForEnvironment(env: WorkerEnv): AccountService {
  let repository: AccountRepository;
  try {
    repository = createAccountRepositoryForEnvironment(env);
  } catch (error) {
    const unavailableStorage: AccountStateStorage = {
      read: () => Promise.reject(error),
      compareAndSet: () => Promise.reject(error)
    };
    repository = createAccountRepository({
      storage: unavailableStorage,
      primarySecret: env.ACCOUNT_STATE_SECRET ?? env.SESSION_SECRET
    });
  }
  return createAccountService({
    repository,
    env
  });
}
