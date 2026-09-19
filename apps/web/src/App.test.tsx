import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { AppServices } from "./app/AppServices";
import { createBrowserAppServices } from "./app/createBrowserAppServices";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn()
  })
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
});

afterEach(cleanup);

describe("App composition", () => {
  it("projects the bootstrap branch when no account is available", async () => {
    const browserServices = createBrowserAppServices();
    const getHealth = vi.fn<AppServices["accountTransport"]["getHealth"]>(() => new Promise(() => undefined));
    const services = {
      ...browserServices,
      accountTransport: { ...browserServices.accountTransport, getHealth },
      accountSession: { ...browserServices.accountSession, getHealth }
    } satisfies AppServices;

    render(<App services={services} />);

    expect(await screen.findByText(/Checking session requirements/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create folder/i })).not.toBeInTheDocument();
  });
});
