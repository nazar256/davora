import { AccountStoreDurableObject } from "../../src/accounts/durable-object";

import { env } from "./workerApplicationHarness";

export function createDurableObjectEnv(overrides: Record<string, string> = {}) {
  const storage = new Map<string, unknown>();
  let failGetStatus: number | undefined;
  let failPutStatus: number | undefined;
  let deferNextGet = false;
  let deferredGet: { response: Response; resolve: (response: Response) => void } | undefined;
  let deferredGetStarted: Promise<void> | undefined;
  let resolveDeferredGetStarted: (() => void) | undefined;
  let deferNextPut = false;
  let deferredPutResolve: (() => void) | undefined;
  let deferredPutStarted: Promise<void> | undefined;
  let resolveDeferredPutStarted: (() => void) | undefined;

  const envWithBinding = {
    ...env,
    ...overrides,
    DAVORA_ACCOUNT_STORE: {
      idFromName(name: string) {
        return { toString: () => name };
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            const object = new AccountStoreDurableObject({
              storage: {
                async get<T>(key: string): Promise<T | undefined> {
                  return storage.get(key) as T | undefined;
                },
                async put(key: string, value: unknown) {
                  storage.set(key, value);
                }
              }
            });

            const request = input instanceof Request
              ? input
              : new Request(String(input), init);

            const url = new URL(request.url);
            if (url.pathname === "/accounts" && request.method === "GET" && failGetStatus) {
              return new Response(JSON.stringify({ message: "forced get failure" }), { status: failGetStatus, headers: { "content-type": "application/json" } });
            }
            if (url.pathname === "/accounts" && request.method === "PUT" && failPutStatus) {
              return new Response(JSON.stringify({ message: "forced put failure" }), { status: failPutStatus, headers: { "content-type": "application/json" } });
            }

            if (url.pathname === "/accounts" && request.method === "GET" && deferNextGet) {
              deferNextGet = false;
              const response = await object.fetch(request);
              resolveDeferredGetStarted?.();
              return new Promise<Response>((resolve) => {
                deferredGet = { response, resolve };
              });
            }

            if (url.pathname === "/accounts" && request.method === "PUT" && deferNextPut) {
              deferNextPut = false;
              resolveDeferredPutStarted?.();
              await new Promise<void>((resolve) => {
                deferredPutResolve = resolve;
              });
            }

            return object.fetch(request);
          }
        };
      }
    }
  };

  return {
    env: envWithBinding,
    storage,
    setFailGetStatus(status: number | undefined) {
      failGetStatus = status;
    },
    setFailPutStatus(status: number | undefined) {
      failPutStatus = status;
    },
    deferNextGet() {
      deferNextGet = true;
      deferredGetStarted = new Promise<void>((resolve) => {
        resolveDeferredGetStarted = resolve;
      });
    },
    waitForDeferredGet() {
      return deferredGetStarted ?? Promise.reject(new Error("No deferred durable GET was configured."));
    },
    releaseDeferredGet() {
      const pending = deferredGet;
      deferredGet = undefined;
      pending?.resolve(pending.response);
    },
    deferNextPut() {
      deferNextPut = true;
      deferredPutStarted = new Promise<void>((resolve) => {
        resolveDeferredPutStarted = resolve;
      });
    },
    waitForDeferredPut() {
      return deferredPutStarted ?? Promise.reject(new Error("No deferred durable PUT was configured."));
    },
    releaseDeferredPut() {
      const resolve = deferredPutResolve;
      deferredPutResolve = undefined;
      resolve?.();
    }
  };
}

