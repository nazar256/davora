// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../test/accounts";
import { createAccountRegistryService, type AccountRegistryStorage } from "./service";
import { useAccountRegistry } from "./useAccountRegistry";

describe("useAccountRegistry", () => {
  it("runs a pending repair once across StrictMode effect replay", async () => {
    const account = buildAccount("alpha");
    const writeItem = vi.fn(() => ({ ok: true as const, value: undefined }));
    const storage: AccountRegistryStorage = {
      readItem: vi.fn(() => ({ ok: true as const, value: JSON.stringify({ activeAccountId: "missing", accounts: [{ account }] }) })),
      writeItem,
      deleteItem: vi.fn(() => ({ ok: true as const, value: undefined }))
    };
    const service = createAccountRegistryService(storage);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

    const { result } = renderHook(() => useAccountRegistry(service), { wrapper });

    expect(result.current.activeRecord?.account.id).toBe(account.id);
    await waitFor(() => expect(writeItem).toHaveBeenCalledTimes(1));
  });

  it("publishes committed snapshots and makes stale repair work inert", async () => {
    const account = buildAccount("alpha");
    const storage: AccountRegistryStorage = {
      readItem: vi.fn(() => ({ ok: true as const, value: null })),
      writeItem: vi.fn(() => ({ ok: true as const, value: undefined })),
      deleteItem: vi.fn(() => ({ ok: true as const, value: undefined }))
    };
    const service = createAccountRegistryService(storage);
    const { result } = renderHook(() => useAccountRegistry(service));

    service.commitConnectedAccount(account);

    await waitFor(() => expect(result.current.activeRecord?.account.id).toBe(account.id));
  });
});
