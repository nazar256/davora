import { renderHook } from "@testing-library/react";
import { act, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useFolderLoadCoordination,
  type FolderLoadCoordinationInput,
  type FolderLoadCoordinationOptions,
  type FolderLoadCoordinationResult
} from "./useFolderLoadCoordination";

type InputHarness = {
  readonly input: FolderLoadCoordinationInput;
  readonly currentPath: { value: string };
  readonly pathReads: { count: number };
  readonly navigated: string[];
  readonly reloadCalls: FolderLoadCoordinationOptions[];
  readonly reload: ReturnType<typeof vi.fn>;
};

function createInput(options: {
  readonly hasActiveAccount?: boolean;
  readonly cacheNamespace?: string;
  readonly token?: string;
  readonly cacheOnlyMode?: boolean;
  readonly initialPath?: string;
  readonly reloadResult?: FolderLoadCoordinationResult;
  readonly reloadImplementation?: (options: FolderLoadCoordinationOptions) => FolderLoadCoordinationResult | Promise<FolderLoadCoordinationResult>;
} = {}): InputHarness {
  const currentPath = { value: options.initialPath ?? "Home" };
  const pathReads = { count: 0 };
  const navigated: string[] = [];
  const reloadCalls: FolderLoadCoordinationOptions[] = [];
  const reload = vi.fn(async (loadOptions: FolderLoadCoordinationOptions = {}) => {
    reloadCalls.push(loadOptions);
    return options.reloadImplementation?.(loadOptions) ?? options.reloadResult;
  });
  return {
    currentPath,
    input: {
      authority: {
        hasActiveAccount: options.hasActiveAccount ?? true,
        cacheNamespace: "cacheNamespace" in options ? options.cacheNamespace : "cache-alpha",
        token: "token" in options ? options.token : "token-alpha",
        cacheOnlyMode: options.cacheOnlyMode ?? false
      },
      navigation: {
        getCurrentPath: () => {
          pathReads.count += 1;
          return currentPath.value;
        },
        setCurrentPath: (path) => {
          navigated.push(path);
          currentPath.value = path;
        }
      },
      reload
    },
    navigated,
    pathReads,
    reload,
    reloadCalls
  };
}

describe("useFolderLoadCoordination", () => {
  it.each([
    ["missing token", { token: undefined, cacheOnlyMode: false }],
    ["missing namespace", { cacheNamespace: undefined }],
    ["missing account", { hasActiveAccount: false }]
  ] as const)("does no work for %s", async (_label, options) => {
    const harness = createInput(options);
    const { result } = renderHook(() => useFolderLoadCoordination(harness.input));

    await act(async () => {
      await expect(result.current.loadFolder("Archive")).resolves.toBeUndefined();
    });

    expect(harness.pathReads.count).toBe(0);
    expect(harness.navigated).toEqual([]);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("allows tokenless cache-only reload with the exact options object", async () => {
    const harness = createInput({ token: undefined, cacheOnlyMode: true });
    const options: FolderLoadCoordinationOptions = { preferCache: true, announceStatus: false };
    const { result } = renderHook(() => useFolderLoadCoordination(harness.input));

    await act(async () => {
      await expect(result.current.loadFolder("Home", options)).resolves.toBeUndefined();
    });

    expect(harness.pathReads.count).toBe(1);
    expect(harness.navigated).toEqual([]);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.reload.mock.calls[0]?.[0]).toBe(options);
  });

  it("navigates a non-current path once without reloading", async () => {
    const harness = createInput();
    const { result } = renderHook(() => useFolderLoadCoordination(harness.input));

    await act(async () => {
      await expect(result.current.loadFolder("Archive", { preferCache: false })).resolves.toBeUndefined();
    });

    expect(harness.pathReads.count).toBe(1);
    expect(harness.navigated).toEqual(["Archive"]);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("reloads the current path and preserves omitted defaults", async () => {
    const harness = createInput();
    const options: FolderLoadCoordinationOptions = { preferCache: false, announceStatus: true };
    const { result } = renderHook(() => useFolderLoadCoordination(harness.input));

    await act(async () => {
      await result.current.loadFolder("Home", options);
      await result.current.loadFolder("Home");
    });

    expect(harness.reload).toHaveBeenCalledTimes(2);
    expect(harness.reload.mock.calls[0]?.[0]).toBe(options);
    expect(harness.reload.mock.calls[1]?.[0]).toEqual({});
    expect(harness.navigated).toEqual([]);
  });

  it("propagates fulfilled, terminal, thrown, and rejected reload outcomes", async () => {
    const terminal = createInput({ reloadResult: "session-terminated" });
    const fulfilled = renderHook(() => useFolderLoadCoordination(terminal.input));
    await expect(fulfilled.result.current.loadFolder("Home")).resolves.toBe("session-terminated");

    const empty = createInput({ reloadResult: undefined });
    const emptyView = renderHook(() => useFolderLoadCoordination(empty.input));
    await expect(emptyView.result.current.loadFolder("Home")).resolves.toBeUndefined();

    const thrown = new Error("reload-throw");
    const throwing = createInput({ reloadImplementation: () => { throw thrown; } });
    const throwingView = renderHook(() => useFolderLoadCoordination(throwing.input));
    await expect(throwingView.result.current.loadFolder("Home")).rejects.toBe(thrown);

    const rejected = new Error("reload-reject");
    const rejecting = createInput({ reloadImplementation: () => Promise.reject(rejected) });
    const rejectingView = renderHook(() => useFolderLoadCoordination(rejecting.input));
    await expect(rejectingView.result.current.loadFolder("Home")).rejects.toBe(rejected);
  });

  it("reads the current path at invocation time", async () => {
    const harness = createInput();
    const { result } = renderHook(() => useFolderLoadCoordination(harness.input));
    harness.currentPath.value = "Archive";
    const options: FolderLoadCoordinationOptions = { preferCache: false };

    await expect(result.current.loadFolder("Archive", options)).resolves.toBeUndefined();

    expect(harness.navigated).toEqual([]);
    expect(harness.reloadCalls[0]).toBe(options);
    expect(harness.pathReads.count).toBe(1);
  });

  it("keeps one stable command while using replacement authority, navigation, and reload owners", async () => {
    const first = createInput({ token: "token-first" });
    const second = createInput({ token: "token-second" });
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: first.input }
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({ input: second.input });
    });
    const options: FolderLoadCoordinationOptions = { preferCache: true };
    await expect(command("Home", options)).resolves.toBeUndefined();

    expect(result.current.loadFolder).toBe(command);
    expect(first.reload).not.toHaveBeenCalled();
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(second.reload.mock.calls[0]?.[0]).toBe(options);
  });

  it("uses an independently replaced authority while retaining navigation and reload owners", async () => {
    const base = createInput();
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: base.input }
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({
        input: {
          ...base.input,
          authority: { ...base.input.authority, token: undefined, cacheOnlyMode: false }
        }
      });
    });
    await expect(command("Home")).resolves.toBeUndefined();
    expect(base.pathReads.count).toBe(0);
    expect(base.reload).not.toHaveBeenCalled();

    act(() => {
      rerender({
        input: {
          ...base.input,
          authority: { ...base.input.authority, token: "token-replaced" }
        }
      });
    });
    const options: FolderLoadCoordinationOptions = { preferCache: false };
    await expect(command("Home", options)).resolves.toBeUndefined();
    expect(base.pathReads.count).toBe(1);
    expect(base.reload).toHaveBeenCalledTimes(1);
    expect(base.reload.mock.calls[0]?.[0]).toBe(options);
    expect(result.current.loadFolder).toBe(command);
  });

  it("uses an independently replaced navigation owner while retaining authority and reload owners", async () => {
    const base = createInput({ initialPath: "Home" });
    const replacement = createInput({ initialPath: "Archive" });
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: base.input }
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({ input: { ...base.input, navigation: replacement.input.navigation } });
    });
    const options: FolderLoadCoordinationOptions = { preferCache: true };
    await expect(command("Archive", options)).resolves.toBeUndefined();

    expect(base.pathReads.count).toBe(0);
    expect(replacement.pathReads.count).toBe(1);
    expect(base.reload).toHaveBeenCalledTimes(1);
    expect(base.reload.mock.calls[0]?.[0]).toBe(options);
    expect(result.current.loadFolder).toBe(command);
  });

  it("uses an independently replaced reload owner while retaining authority and navigation owners", async () => {
    const base = createInput();
    const replacement = createInput();
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: base.input }
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({ input: { ...base.input, reload: replacement.reload } });
    });
    const options: FolderLoadCoordinationOptions = { announceStatus: false };
    await expect(command("Home", options)).resolves.toBeUndefined();

    expect(base.reload).not.toHaveBeenCalled();
    expect(replacement.reload).toHaveBeenCalledTimes(1);
    expect(replacement.reload.mock.calls[0]?.[0]).toBe(options);
    expect(result.current.loadFolder).toBe(command);
  });

  it("uses the distinct latest Alpha owner after an Alpha-to-Beta-to-Alpha replacement cycle", async () => {
    const alphaOne = createInput({ token: "token-alpha-one" });
    const beta = createInput({ token: "token-beta" });
    const alphaTwo = createInput({ token: "token-alpha-two" });
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: alphaOne.input }
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({ input: beta.input });
    });
    act(() => {
      rerender({ input: alphaTwo.input });
    });
    const options: FolderLoadCoordinationOptions = { preferCache: false };
    await expect(command("Home", options)).resolves.toBeUndefined();

    expect(alphaOne.reload).not.toHaveBeenCalled();
    expect(beta.reload).not.toHaveBeenCalled();
    expect(alphaTwo.reload).toHaveBeenCalledTimes(1);
    expect(alphaTwo.reload.mock.calls[0]?.[0]).toBe(options);
    expect(result.current.loadFolder).toBe(command);
  });

  it("keeps the public command quiescent after unmount", async () => {
    const harness = createInput();
    const view = renderHook(() => useFolderLoadCoordination(harness.input));
    const command = view.result.current.loadFolder;
    view.unmount();

    await expect(command("Home")).resolves.toBeUndefined();
    expect(harness.pathReads.count).toBe(1);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("preserves command identity and latest input under StrictMode", async () => {
    const first = createInput({ token: "token-first" });
    const second = createInput({ token: "token-second" });
    const { result, rerender } = renderHook(({ input }) => useFolderLoadCoordination(input), {
      initialProps: { input: first.input },
      wrapper: StrictMode
    });
    const command = result.current.loadFolder;

    act(() => {
      rerender({ input: second.input });
    });
    await expect(result.current.loadFolder("Home")).resolves.toBeUndefined();

    expect(result.current.loadFolder).toBe(command);
    expect(first.reload).not.toHaveBeenCalled();
    expect(second.reload).toHaveBeenCalledTimes(1);
  });
});
