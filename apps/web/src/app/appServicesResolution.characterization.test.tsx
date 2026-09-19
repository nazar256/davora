// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

import type { AppServices } from "./AppServices";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(sourceDir, "../App.tsx");
const compositionPath = resolve(sourceDir, "./useBrowserWorkspaceComposition.tsx");
const resolverPath = resolve(sourceDir, "./resolveAppServices.ts");
const appServicesPath = resolve(sourceDir, "./AppServices.ts");
const browserServicesPath = resolve(sourceDir, "./createBrowserAppServices.ts");
const appSource = readFileSync(appPath, "utf8");
const compositionSource = readFileSync(compositionPath, "utf8");
const resolverSource = readFileSync(resolverPath, "utf8");
const appServicesSource = readFileSync(appServicesPath, "utf8");
const browserServicesSource = readFileSync(browserServicesPath, "utf8");
const resolverStart = resolverSource.indexOf("export function resolveAppServices(");
if (resolverStart < 0) throw new Error("resolveAppServices export is missing");
const resolverFunctionSource = resolverSource.slice(resolverStart + "export ".length).trim();
const expectedResolverFunctionSource = `function resolveAppServices(
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
}`;
const resolverCall = "const services = resolveAppServices(providedServices, fallbackServices);";
const resolverCallIndex = appSource.indexOf(resolverCall);
if (resolverCallIndex < 0) throw new Error("resolveAppServices call is missing");
const downstreamCompositionSource = compositionSource;

const capabilityKeys = [
  "accountRegistry",
  "accountTransport",
  "accountSession",
  "browsingCache",
  "favouriteResolveRuntime",
  "connectivity",
  "explicitOfflineRuntime",
  "clock",
  "favourites",
  "favouritesPointerEnvironment",
  "folder",
  "history",
  "pullToRefreshEnvironment",
  "responsiveViewport",
  "search",
  "settings",
  "operationRuntime",
  "offlineSyncRuntime",
  "retentionRepository",
  "previewRuntime",
  "accountRemovalRuntime",
  "diagnostics"
] as const;

type Resolver = (
  providedServices: AppServices | undefined,
  fallbackServices: { current: AppServices | undefined }
) => AppServices;

const characterization = { branches: [] as string[], adversaries: [] as string[] };

function serviceSentinel(label: string): AppServices {
  // The resolver only returns this opaque identity; no service capability is invoked here.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return { label } as unknown as AppServices;
}

function compileResolver(factory: () => AppServices): Resolver {
  const output = ts.transpileModule(
    `${resolverFunctionSource}\nglobalThis.resolveAppServices = resolveAppServices;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText;
  const context: { createBrowserAppServices: () => AppServices; resolveAppServices?: Resolver } = {
    createBrowserAppServices: factory
  };
  runInNewContext(output, context);
  if (!context.resolveAppServices) throw new Error("Compiled resolver was not published");
  return context.resolveAppServices;
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function assertResolverSource(source: string): void {
  expect(count(source, "return providedServices;")).toBe(1);
  expect(count(source, "createBrowserAppServices()")).toBe(1);
  expect(source).toContain("if (!fallbackServices.current) {");
  expect(source).toContain("fallbackServices.current = createBrowserAppServices();");
  expect(source).toContain("return fallbackServices.current;");
  expect(source).not.toMatch(/Object\.assign|structuredClone|JSON\.(?:parse|stringify)|\.\.\./);
  expect(source).not.toMatch(/\b(?:try|catch|finally|async|await|Promise|globalThis|window|document|localStorage|sessionStorage)\b/);
}

function assertExactCapabilitySurface(): void {
  const body = appServicesSource.match(/export interface AppServices \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const declaredKeys = [...body.matchAll(/readonly\s+(\w+):/g)].map((match) => match[1]);
  expect(declaredKeys).toEqual([...capabilityKeys]);

  const returnStart = browserServicesSource.indexOf("  return {");
  const returnEnd = browserServicesSource.indexOf("\n  };", returnStart);
  expect(returnStart).toBeGreaterThanOrEqual(0);
  expect(returnEnd).toBeGreaterThan(returnStart);
  const returnBody = browserServicesSource.slice(returnStart, returnEnd);
  const returnedKeys = [...returnBody.matchAll(/^\s{4}(\w+)(?::.*)?,?$/gm)].map((match) => match[1]);
  expect(returnedKeys).toEqual([...capabilityKeys]);
  expect(browserServicesSource).toContain("const browsingCache = createBrowsingCacheRepository(storage, clock);");
  expect(browserServicesSource).toContain("const retentionRepository = createOpenedFileRepository();");
  expect(browserServicesSource).toContain("folder: createBrowserFolderPorts(browsingCache),");
  expect(browserServicesSource).toContain("search: createBrowserSearchPorts(browsingCache),");
  expect(browserServicesSource).toContain("const previewRuntime = createPreviewComposition({ retentionRepository });");
  characterization.branches.push("exact-21-capability-surface", "shared-cache-retention-aliases");
}

function assertDownstreamServicesOnly(): void {
  expect(count(appSource, resolverCall)).toBe(1);
  expect(appSource).toContain("const fallbackServices = useRef<AppServices | undefined>(undefined);");
  expect(downstreamCompositionSource).not.toContain("providedServices");
  expect(downstreamCompositionSource).not.toMatch(/\bcreateBrowserAppServices\s*\(/);
  expect(downstreamCompositionSource).toContain("const browsingCache = services.browsingCache;");
  expect(downstreamCompositionSource).toContain("const retentionRepository = services.retentionRepository;");
  characterization.branches.push("single-resolved-services-object", "no-provided-services-bypass");
}

function assertSourceRejectsCausalMutants(): void {
  const mutants = [
    resolverFunctionSource.replace("if (providedServices) {", "createBrowserAppServices();\n  if (providedServices) {"),
    resolverFunctionSource.replace("return providedServices;", "return { ...providedServices };"),
    resolverFunctionSource.replace("fallbackServices.current = createBrowserAppServices();", "fallbackServices.current = alternateServicesFactory();"),
    resolverFunctionSource.replace("return fallbackServices.current;", "return undefined;"),
    resolverFunctionSource.replace("if (!fallbackServices.current) {", "if (true) {")
  ];
  for (const mutant of mutants) {
    expect(() => assertResolverSource(mutant)).toThrow();
    characterization.adversaries.push("resolver-mutant-rejected");
  }
  const bypassed = downstreamCompositionSource.replace("const browsingCache = services.browsingCache;", "const browsingCache = providedServices.browsingCache;");
  expect(() => {
    expect(bypassed).not.toContain("providedServices");
  }).toThrow();
  characterization.adversaries.push("downstream-provided-services-bypass-rejected");
}

describe("AppServices resolution and fallback lifetime", () => {
  it("locks the resolver shape, one fallback ref, and no eager construction", () => {
    expect(count(appSource, "function resolveAppServices(")).toBe(0);
    expect(count(resolverSource, "export function resolveAppServices(")).toBe(1);
    expect(resolverFunctionSource).toBe(expectedResolverFunctionSource);
    expect(appSource).toContain('import { resolveAppServices } from "./app/resolveAppServices";');
    expect(count(appSource, "const fallbackServices = useRef<AppServices | undefined>(undefined);")).toBe(1);
    expect(count(appSource, "const appShell = useBrowserWorkspaceComposition(services);")).toBe(1);
    expect(count(compositionSource, "return useAppWorkspacePresentation({")).toBe(1);
    expect(compositionSource).toContain("services: { favourites: services.favourites, favouritesPointerEnvironment: services.favouritesPointerEnvironment, favouriteResolveRuntime: services.favouriteResolveRuntime }");
    assertResolverSource(resolverSource);
    characterization.branches.push("resolver-source-lock", "byte-semantic-extraction", "per-app-fallback-ref", "no-eager-construction");
  });

  it("returns injected services by exact identity without constructing fallback", () => {
    const factory = vi.fn(() => serviceSentinel("fallback"));
    const resolve = compileResolver(factory);
    const provided = serviceSentinel("provided");
    const ref = { current: undefined as AppServices | undefined };
    expect(resolve(provided, ref)).toBe(provided);
    expect(factory).not.toHaveBeenCalled();
    expect(ref.current).toBeUndefined();
    characterization.branches.push("provided-identity", "zero-fallback-construction");
  });

  it("constructs one stable fallback per resolver ref", () => {
    const fallback = serviceSentinel("fallback");
    const factory = vi.fn(() => fallback);
    const resolve = compileResolver(factory);
    const firstRef = { current: undefined as AppServices | undefined };
    const secondRef = { current: undefined as AppServices | undefined };
    const first = resolve(undefined, firstRef);
    expect(resolve(undefined, firstRef)).toBe(first);
    expect(resolve(undefined, firstRef)).toBe(first);
    expect(resolve(undefined, secondRef)).toBe(fallback);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(firstRef.current).toBe(first);
    expect(secondRef.current).toBe(fallback);
    characterization.branches.push("stable-fallback-identity", "once-per-resolver-ref");
  });

  it("reuses fallback across provided Alpha, provided Beta, and fallback again", () => {
    const fallback = serviceSentinel("fallback");
    const alpha = serviceSentinel("alpha");
    const beta = serviceSentinel("beta");
    const factory = vi.fn(() => fallback);
    const resolve = compileResolver(factory);
    const ref = { current: undefined as AppServices | undefined };
    expect(resolve(undefined, ref)).toBe(fallback);
    expect(resolve(alpha, ref)).toBe(alpha);
    expect(resolve(beta, ref)).toBe(beta);
    expect(resolve(undefined, ref)).toBe(fallback);
    expect(factory).toHaveBeenCalledTimes(1);
    characterization.branches.push("fallback-alpha-beta-fallback", "exact-provided-replacement");
  });

  it("preserves factory exception identity and retries after failed construction", () => {
    const failure = new Error("factory sentinel");
    const recovered = serviceSentinel("recovered");
    const factory = vi.fn<() => AppServices>()
      .mockImplementationOnce(() => { throw failure; })
      .mockReturnValueOnce(recovered);
    const resolve = compileResolver(factory);
    const ref = { current: undefined as AppServices | undefined };
    expect(() => resolve(undefined, ref)).toThrow(failure);
    expect(ref.current).toBeUndefined();
    expect(resolve(undefined, ref)).toBe(recovered);
    expect(factory).toHaveBeenCalledTimes(2);
    characterization.branches.push("factory-error-identity", "retry-after-failure", "no-poisoned-ref");
  });

  it("does not merge, clone, mutate, freeze, or eagerly create service objects", () => {
    const provided = serviceSentinel("provided");
    const fallback = serviceSentinel("fallback");
    const factory = vi.fn(() => fallback);
    const resolve = compileResolver(factory);
    const ref = { current: undefined as AppServices | undefined };
    expect(Object.isFrozen(provided)).toBe(false);
    expect(resolve(provided, ref)).toBe(provided);
    expect(Object.isFrozen(provided)).toBe(false);
    expect(ref.current).toBeUndefined();
    expect(Object.isFrozen(fallback)).toBe(false);
    expect(resolve(undefined, ref)).toBe(fallback);
    expect(ref.current).toBe(fallback);
    expect(Object.isFrozen(fallback)).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    characterization.branches.push("identity-no-clone", "no-mutation", "no-freeze");
  });

  it("keeps downstream composition on the single resolved services object", () => {
    assertDownstreamServicesOnly();
  });

  it("keeps the exact capability surface and shared repository aliases", () => {
    assertExactCapabilitySurface();
  });

  it("rejects eager, duplicate, alternate, lost-fallback, and poisoned resolver mutants", () => {
    assertSourceRejectsCausalMutants();
  });

  it("remains synchronous, resource-free, and scoped per resolver ref", () => {
    expect(resolverSource).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|addEventListener|removeEventListener)\b/);
    expect(resolverSource).not.toMatch(/\b(?:useRef|useMemo|useEffect|subscribe|dispose|close|abort)\b/);
    expect(appSource).not.toMatch(/(?:module|globalThis)\.fallbackServices/);
    const firstFallback = serviceSentinel("first");
    const secondFallback = serviceSentinel("second");
    const firstFactory = vi.fn(() => firstFallback);
    const secondFactory = vi.fn(() => secondFallback);
    const firstResolve = compileResolver(firstFactory);
    const secondResolve = compileResolver(secondFactory);
    expect(firstResolve(undefined, { current: undefined })).toBe(firstFallback);
    expect(secondResolve(undefined, { current: undefined })).toBe(secondFallback);
    expect(firstFactory).toHaveBeenCalledTimes(1);
    expect(secondFactory).toHaveBeenCalledTimes(1);
    characterization.branches.push("sync-resource-free", "per-resolver-ref-scope");
    characterization.adversaries.push("global-singleton-rejected", "resource-sink-rejected");
  });
});
