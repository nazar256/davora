import { StrictMode } from "react";

import { act, cleanup, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PdfPreviewStage,
  usePdfPreviewInteraction,
  type PdfDocument,
  type PdfJsModule,
  type PdfLoadingTask,
  type PdfPage,
  type PdfPreviewResizeObserver,
  type PdfPreviewRuntimePorts,
  type PdfRenderTask
} from "./index";

interface TrackedDeferred<T> {
  readonly label: string;
  readonly promise: Promise<T>;
  readonly settled: () => boolean;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
  readonly settleForCleanup: () => void;
}

interface TrackedDeferredRecord {
  readonly label: string;
  readonly settled: () => boolean;
  readonly settleForCleanup: () => void;
}

function createTrackedDeferred<T>(
  deferreds: TrackedDeferredRecord[],
  label: string,
  cleanupValue: () => T
): TrackedDeferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const deferred: TrackedDeferred<T> = {
    label,
    promise,
    settled: () => settled,
    resolve: (value) => {
      if (!settled) {
        settled = true;
        resolvePromise(value);
      }
    },
    reject: (reason) => {
      if (!settled) {
        settled = true;
        rejectPromise(reason);
      }
    },
    settleForCleanup: () => {
      if (!settled) {
        settled = true;
        resolvePromise(cleanupValue());
      }
    }
  };
  deferreds.push(deferred);
  return deferred;
}

interface FakeRenderTask extends PdfRenderTask {
  readonly deferred: TrackedDeferred<void>;
  readonly cancelMock: ReturnType<typeof vi.fn>;
  readonly isCancelled: () => boolean;
}

interface FakePlan {
  readonly label: string;
  readonly loadingDeferred: TrackedDeferred<PdfDocument>;
  readonly loadingTask: PdfLoadingTask;
  readonly destroyMock: ReturnType<typeof vi.fn>;
  readonly isDestroyed: () => boolean;
  readonly pdf: PdfDocument;
  readonly pageDeferreds: Map<number, TrackedDeferred<PdfPage>>;
  readonly pages: Map<number, PdfPage>;
  readonly renderTasks: FakeRenderTask[];
}

interface FakeResponse {
  readonly response: Response;
  fetch: TrackedDeferred<Response>;
  readonly buffer: TrackedDeferred<ArrayBuffer>;
  ok: boolean;
}

interface FakeResizeObserver extends PdfPreviewResizeObserver, Pick<ResizeObserver, "unobserve"> {
  readonly callback: ResizeObserverCallback;
  readonly observeMock: ReturnType<typeof vi.fn>;
  readonly disconnectMock: ReturnType<typeof vi.fn>;
  readonly isActive: () => boolean;
}

interface FakeFrame {
  readonly id: number;
  readonly callback: FrameRequestCallback;
}

interface RuntimeSnapshot {
  readonly pendingLabels: string[];
  readonly loadingTasks: number;
  readonly renderTasks: number;
  readonly observers: number;
  readonly frames: number;
}

function createPdfRuntime() {
  const deferreds: TrackedDeferredRecord[] = [];
  const responses: FakeResponse[] = [];
  const loadCalls: TrackedDeferred<PdfJsModule>[] = [];
  const queuedPlans: FakePlan[] = [];
  const usedPlans: FakePlan[] = [];
  const observers: FakeResizeObserver[] = [];
  const frames: FakeFrame[] = [];
  let nextFrameId = 1;
  let nextPlanId = 1;
  let nextResponseOk = true;
  let documentCallCount = 0;

  const createPlan = (pageCount = 2): FakePlan => {
    const label = `pdf-${nextPlanId}`;
    nextPlanId += 1;
    const pageDeferreds = new Map<number, TrackedDeferred<PdfPage>>();
    const pages = new Map<number, PdfPage>();
    const renderTasks: FakeRenderTask[] = [];
    const destroyMock = vi.fn();
    let destroyed = false;
    let plan!: FakePlan;

    const ensurePage = (pageNumber: number): PdfPage => {
      const existing = pages.get(pageNumber);
      if (existing) {
        return existing;
      }
      const render = vi.fn((_options: Parameters<PdfPage["render"]>[0]): PdfRenderTask => {
        const cancelMock = vi.fn();
        let cancelled = false;
        cancelMock.mockImplementation(() => {
          cancelled = true;
        });
        const deferred = createTrackedDeferred<void>(deferreds, `${label}:render:${pageNumber}`, () => undefined);
        const task: FakeRenderTask = {
          cancel: cancelMock,
          cancelMock,
          deferred,
          isCancelled: () => cancelled,
          promise: deferred.promise
        };
        renderTasks.push(task);
        return task;
      });
      const page: PdfPage = {
        getBaseSize: () => ({ width: 100, height: 140 }),
        render
      };
      pages.set(pageNumber, page);
      pageDeferreds.set(
        pageNumber,
        createTrackedDeferred(deferreds, `${label}:page:${pageNumber}`, () => page)
      );
      return page;
    };

    const pdf: PdfDocument = {
      numPages: pageCount,
      getPage: vi.fn((pageNumber: number): Promise<PdfPage> => {
        ensurePage(pageNumber);
        return pageDeferreds.get(pageNumber)!.promise;
      })
    };
    const loadingDeferred = createTrackedDeferred(deferreds, `${label}:loading`, () => pdf);
    const loadingTask: PdfLoadingTask = {
      destroy: () => {
        destroyMock();
        destroyed = true;
      },
      promise: loadingDeferred.promise
    };
    plan = {
      destroyMock,
      isDestroyed: () => destroyed,
      label,
      loadingDeferred,
      loadingTask,
      pageDeferreds,
      pages,
      pdf,
      renderTasks
    };
    return plan;
  };

  const pdfJsModule: PdfJsModule = {
    getDocument: vi.fn(() => {
      documentCallCount += 1;
      const plan = queuedPlans.shift() ?? createPlan();
      usedPlans.push(plan);
      return plan.loadingTask;
    })
  };

  const ports: PdfPreviewRuntimePorts = {
    createResizeObserver: (callback) => {
      let active = true;
      const observer: FakeResizeObserver = {
        callback,
        disconnect: () => {
          observer.disconnectMock();
          active = false;
        },
        disconnectMock: vi.fn(),
        isActive: () => active,
        observe: (target) => {
          observer.observeMock(target);
        },
        observeMock: vi.fn(),
        unobserve: vi.fn()
      };
      observers.push(observer);
      return observer;
    },
    fetch: vi.fn((_input: string) => {
      const buffer = createTrackedDeferred<ArrayBuffer>(
        deferreds,
        `fetch:${responses.length}:arrayBuffer`,
        () => new ArrayBuffer(8)
      );
      const response = new Response(null, { status: nextResponseOk ? 200 : 500 });
      let record!: FakeResponse;
      const fetch = createTrackedDeferred(deferreds, `fetch:${responses.length}`, () => response);
      record = {
        buffer,
        fetch,
        ok: nextResponseOk,
        response
      };
      Object.defineProperty(response, "ok", {
        configurable: true,
        get: () => record.ok
      });
      vi.spyOn(response, "arrayBuffer").mockImplementation(() => buffer.promise);
      responses.push(record);
      return record.fetch.promise;
    }),
    getDevicePixelRatio: () => 1,
    loadPdfJs: vi.fn(() => {
      const deferred = createTrackedDeferred(deferreds, `loadPdfJs:${loadCalls.length}`, () => pdfJsModule);
      loadCalls.push(deferred);
      return deferred.promise;
    }),
    requestAnimationFrame: (callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.push({ callback, id });
      return id;
    }
  };

  const enqueuePlan = (pageCount = 2) => {
    const plan = createPlan(pageCount);
    queuedPlans.push(plan);
    return plan;
  };

  const resolveFetch = async (index = 0) => {
    const response = responses[index];
    if (!response) {
      throw new Error(`Response ${index} was not requested.`);
    }
    response.fetch.resolve(response.response);
    await flushMicrotasks();
  };

  const rejectFetch = async (index = 0, reason = new Error("fetch failed")) => {
    const response = responses[index];
    if (!response) {
      throw new Error(`Response ${index} was not requested.`);
    }
    response.fetch.reject(reason);
    await flushMicrotasks();
  };

  const resolveResponse = async (index = 0) => {
    const response = responses[index];
    if (!response) {
      throw new Error(`Response ${index} was not requested.`);
    }
    response.fetch.resolve(response.response);
    response.buffer.resolve(new ArrayBuffer(8));
    await flushMicrotasks();
  };

  const rejectBuffer = async (index = 0, reason = new Error("arrayBuffer failed")) => {
    const response = responses[index];
    if (!response) {
      throw new Error(`Response ${index} was not requested.`);
    }
    response.fetch.resolve(response.response);
    await flushMicrotasks();
    response.buffer.reject(reason);
    await flushMicrotasks();
  };

  const resolveLoad = async (index = loadCalls.length - 1) => {
    if (!loadCalls[index]) {
      throw new Error(`loadPdfJs call ${index} was not requested.`);
    }
    loadCalls[index].resolve(pdfJsModule);
    await flushMicrotasks();
  };

  const rejectLoad = async (index = loadCalls.length - 1, reason = new Error("pdf.js load failed")) => {
    if (!loadCalls[index]) {
      throw new Error(`loadPdfJs call ${index} was not requested.`);
    }
    loadCalls[index].reject(reason);
    await flushMicrotasks();
  };

  const resolvePage = async (plan: FakePlan, pageNumber: number) => {
    const deferred = plan.pageDeferreds.get(pageNumber);
    if (!deferred) {
      throw new Error(`Page ${pageNumber} was not requested for ${plan.label}.`);
    }
    deferred.resolve(plan.pages.get(pageNumber)!);
    await flushMicrotasks();
  };

  const rejectPage = async (plan: FakePlan, pageNumber: number, reason = new Error("page failed")) => {
    const deferred = plan.pageDeferreds.get(pageNumber);
    if (!deferred) {
      throw new Error(`Page ${pageNumber} was not requested for ${plan.label}.`);
    }
    deferred.reject(reason);
    await flushMicrotasks();
  };

  const resolveRender = async (task: FakeRenderTask) => {
    task.deferred.resolve(undefined);
    await flushMicrotasks();
  };

  const rejectRender = async (task: FakeRenderTask, reason = new Error("render failed")) => {
    task.deferred.reject(reason);
    await flushMicrotasks();
  };

  const resolveAllResponses = async (start = 0) => {
    for (let index = start; index < responses.length; index += 1) {
      await resolveResponse(index);
    }
  };

  const flushFrames = (limit = Number.POSITIVE_INFINITY) => {
    let flushed = 0;
    while (frames.length > 0 && flushed < limit) {
      const frame = frames.shift()!;
      frame.callback(0);
      flushed += 1;
    }
    return flushed;
  };

  const settleAll = async () => {
    for (let pass = 0; pass < 30; pass += 1) {
      const pending = deferreds.filter((deferred) => !deferred.settled());
      if (pending.length === 0) {
        break;
      }
      pending.forEach((deferred) => deferred.settleForCleanup());
      await flushMicrotasks();
      flushFrames();
    }
  };

  const snapshot = (): RuntimeSnapshot => ({
    frames: frames.length,
    loadingTasks: usedPlans.filter((plan) => !plan.isDestroyed()).length,
    observers: observers.filter((observer) => observer.isActive()).length,
    pendingLabels: deferreds.filter((deferred) => !deferred.settled()).map((deferred) => deferred.label),
    renderTasks: usedPlans.flatMap((plan) => plan.renderTasks).filter((task) => !task.isCancelled()).length
  });

  const retireForTestCleanup = () => {
    usedPlans.forEach((plan) => {
      if (!plan.isDestroyed()) {
        plan.loadingTask.destroy();
      }
      plan.renderTasks.forEach((task) => {
        if (!task.isCancelled()) {
          task.cancel();
        }
      });
    });
    observers.forEach((observer) => {
      if (observer.isActive()) {
        observer.disconnect();
      }
    });
    frames.splice(0, frames.length);
  };

  return {
    enqueuePlan,
    flushFrames,
    loadCalls,
    observers,
    pdfJsModule,
    getDocumentCallCount: () => documentCallCount,
    ports,
    queuedPlans,
    rejectBuffer,
    rejectFetch,
    rejectLoad,
    rejectPage,
    rejectRender,
    resolveAllResponses,
    resolveFetch,
    resolveLoad,
    resolvePage,
    resolveRender,
    resolveResponse,
    responses,
    retireForTestCleanup,
    settleAll,
    snapshot,
    setNextResponseOk: (ok: boolean) => {
      nextResponseOk = ok;
    },
    usedPlans,
    pendingLabels: () => deferreds.filter((deferred) => !deferred.settled()).map((deferred) => deferred.label),
    liveLoadingTasks: () => usedPlans.filter((plan) => !plan.isDestroyed()),
    liveRenderTasks: () => usedPlans.flatMap((plan) => plan.renderTasks).filter((task) => !task.isCancelled()),
    liveObservers: () => observers.filter((observer) => observer.isActive()),
    pendingFrameCount: () => frames.length
  };
}

async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
  });
}

function Harness({
  blobUrl,
  onError,
  ports,
  showStage = true
}: {
  blobUrl: string;
  onError: () => void;
  ports: PdfPreviewRuntimePorts;
  showStage?: boolean;
}) {
  const interaction = usePdfPreviewInteraction({ blobUrl, onError, ports });
  return (
    <>
      <output data-testid="render-state">{interaction.controls.renderState}</output>
      <output data-testid="page-count">{String(interaction.controls.pageCount ?? "")}</output>
      <output data-testid="current-page">{String(interaction.controls.currentPage)}</output>
      {showStage ? <PdfPreviewStage fileName="lifecycle.pdf" interaction={interaction} /> : null}
    </>
  );
}

function renderHarness(
  runtime: ReturnType<typeof createPdfRuntime>,
  blobUrl = "blob:one",
  onError = vi.fn(),
  strict = false,
  showStage = true
): { view: RenderResult; onError: ReturnType<typeof vi.fn> } {
  const element = (
    <Harness blobUrl={blobUrl} onError={onError} ports={runtime.ports} showStage={showStage} />
  );
  const view = render(strict ? <StrictMode>{element}</StrictMode> : element);
  return { onError, view };
}

async function startFetch(runtime: ReturnType<typeof createPdfRuntime>) {
  await flushMicrotasks();
  expect(runtime.responses.length).toBeGreaterThan(0);
  return runtime.responses.length - 1;
}

async function advanceToLoadingTask(runtime: ReturnType<typeof createPdfRuntime>) {
  await startFetch(runtime);
  await runtime.resolveAllResponses();
  expect(runtime.loadCalls.length).toBeGreaterThan(0);
  await runtime.resolveLoad(runtime.loadCalls.length - 1);
  expect(runtime.usedPlans.length).toBeGreaterThan(0);
  return runtime.usedPlans[runtime.usedPlans.length - 1];
}

async function advanceToFirstRenderTask(
  runtime: ReturnType<typeof createPdfRuntime>,
  plan: FakePlan
) {
  plan.loadingDeferred.resolve(plan.pdf);
  await flushMicrotasks();
  await runtime.resolvePage(plan, 1);
  runtime.flushFrames();
  await flushMicrotasks();
  expect(plan.renderTasks).toHaveLength(1);
  return plan.renderTasks[0];
}

function expectQuiescent(runtime: ReturnType<typeof createPdfRuntime>) {
  expectQuiescentSnapshot(runtime.snapshot());
}

function expectQuiescentSnapshot(snapshot: RuntimeSnapshot) {
  expect(snapshot).toEqual({
    frames: 0,
    loadingTasks: 0,
    observers: 0,
    pendingLabels: [],
    renderTasks: 0
  });
}

async function closeRuntimeInternal(
  runtime: ReturnType<typeof createPdfRuntime>,
  allowPreRetirementLeaks: boolean,
  ...views: RenderResult[]
): Promise<RuntimeSnapshot> {
  views.forEach((view) => view.unmount());
  await flushMicrotasks();
  await runtime.settleAll();
  await flushMicrotasks();
  runtime.flushFrames();
  await runtime.settleAll();
  await flushMicrotasks();
  const beforeTestRetirement = runtime.snapshot();
  if (!allowPreRetirementLeaks) {
    expectQuiescentSnapshot(beforeTestRetirement);
  }
  runtime.retireForTestCleanup();
  await runtime.settleAll();
  runtime.flushFrames();
  await flushMicrotasks();
  expectQuiescent(runtime);
  return beforeTestRetirement;
}

async function closeRuntime(
  runtime: ReturnType<typeof createPdfRuntime>,
  ...views: RenderResult[]
): Promise<RuntimeSnapshot> {
  return closeRuntimeInternal(runtime, false, ...views);
}

async function closeRuntimeAllowingExpectedLeaks(
  runtime: ReturnType<typeof createPdfRuntime>,
  ...views: RenderResult[]
): Promise<RuntimeSnapshot> {
  return closeRuntimeInternal(runtime, true, ...views);
}

const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;

describe("usePdfPreviewInteraction PDF.js task-lifetime characterization", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({ clearRect: vi.fn() }))
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalCanvasGetContext,
      writable: true
    });
  });

  it("T01 current mounted source/port/stage identity starts one pipeline and harmless rerenders do not restart it", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      await startFetch(runtime);
      view.rerender(<Harness blobUrl="blob:one" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      expect(runtime.ports.fetch).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntimeAllowingExpectedLeaks(runtime, view);
    }
  });

  it("T02 cleanup while loading is pending defers exact destroy for both resolve and reject", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const runtime = createPdfRuntime();
      const { view } = renderHarness(runtime);
      try {
        const plan = await advanceToLoadingTask(runtime);
        view.unmount();
        await flushMicrotasks();
        expect(plan.destroyMock).not.toHaveBeenCalled();
        if (outcome === "resolve") {
          plan.loadingDeferred.resolve(plan.pdf);
        } else {
          plan.loadingDeferred.reject(new Error("loading failed"));
        }
        await flushMicrotasks();
        expect(plan.destroyMock).toHaveBeenCalledTimes(1);
        expect(runtime.liveLoadingTasks()).toHaveLength(0);
      } finally {
        await closeRuntime(runtime, view);
      }
    }
  });

  it("T03 settled loading cleanup destroys exactly once across source, port, and stage replacement", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    const firstPlan = await advanceToLoadingTask(runtime);
    try {
      firstPlan.loadingDeferred.resolve(firstPlan.pdf);
      await flushMicrotasks();
      runtime.enqueuePlan(1);
      const replacementResponseStart = runtime.responses.length;
      view.rerender(<Harness blobUrl="blob:two" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      expect(firstPlan.destroyMock).toHaveBeenCalledTimes(1);
      await runtime.resolveAllResponses(replacementResponseStart);
      await runtime.resolveLoad(runtime.loadCalls.length - 1);
      const secondPlan = runtime.usedPlans[runtime.usedPlans.length - 1];
      secondPlan.loadingDeferred.resolve(secondPlan.pdf);
      await flushMicrotasks();
      expect(firstPlan.destroyMock).toHaveBeenCalledTimes(1);

      view.rerender(<Harness blobUrl="blob:three" onError={vi.fn()} ports={runtime.ports} showStage={false} />);
      await flushMicrotasks();
      expect(secondPlan.destroyMock).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(runtime, view);
    }

    const oldRuntime = createPdfRuntime();
    const newRuntime = createPdfRuntime();
    const old = renderHarness(oldRuntime);
    try {
      const oldPlan = await advanceToLoadingTask(oldRuntime);
      oldPlan.loadingDeferred.resolve(oldPlan.pdf);
      await flushMicrotasks();
      const replacementPlan = newRuntime.enqueuePlan(1);
      old.view.rerender(<Harness blobUrl="blob:port" onError={vi.fn()} ports={newRuntime.ports} />);
      await flushMicrotasks();
      expect(oldPlan.destroyMock).toHaveBeenCalledTimes(1);
      await newRuntime.resolveAllResponses();
      await newRuntime.resolveLoad();
      replacementPlan.loadingDeferred.resolve(replacementPlan.pdf);
      await flushMicrotasks();
    } finally {
      await closeRuntime(oldRuntime, old.view);
      await closeRuntime(newRuntime);
    }
  });

  it("T03b pending loading cleanup defers destroy across blob, port, and stage replacement", async () => {
    const blobRuntime = createPdfRuntime();
    const blob = renderHarness(blobRuntime, "blob:old");
    try {
      const oldPlan = await advanceToLoadingTask(blobRuntime);
      blob.view.rerender(<Harness blobUrl="blob:new" onError={vi.fn()} ports={blobRuntime.ports} />);
      await flushMicrotasks();
      expect(oldPlan.destroyMock).not.toHaveBeenCalled();
      oldPlan.loadingDeferred.resolve(oldPlan.pdf);
      await flushMicrotasks();
      expect(oldPlan.destroyMock).toHaveBeenCalledTimes(1);
      blob.view.rerender(<Harness blobUrl="blob:new" onError={vi.fn()} ports={blobRuntime.ports} showStage={false} />);
      await flushMicrotasks();
    } finally {
      await closeRuntime(blobRuntime, blob.view);
    }

    const oldRuntime = createPdfRuntime();
    const replacementRuntime = createPdfRuntime();
    const port = renderHarness(oldRuntime, "blob:old-port");
    try {
      const oldPlan = await advanceToLoadingTask(oldRuntime);
      port.view.rerender(
        <Harness blobUrl="blob:new-port" onError={vi.fn()} ports={replacementRuntime.ports} />
      );
      await flushMicrotasks();
      expect(oldPlan.destroyMock).not.toHaveBeenCalled();
      oldPlan.loadingDeferred.reject(new Error("old port loading failed"));
      await flushMicrotasks();
      expect(oldPlan.destroyMock).toHaveBeenCalledTimes(1);
      port.view.rerender(
        <Harness blobUrl="blob:new-port" onError={vi.fn()} ports={replacementRuntime.ports} showStage={false} />
      );
      await flushMicrotasks();
    } finally {
      await closeRuntime(oldRuntime, port.view);
      await closeRuntime(replacementRuntime);
    }

    const stageRuntime = createPdfRuntime();
    const stage = renderHarness(stageRuntime, "blob:old-stage");
    try {
      const oldPlan = await advanceToLoadingTask(stageRuntime);
      stage.view.rerender(
        <Harness blobUrl="blob:old-stage" onError={vi.fn()} ports={stageRuntime.ports} showStage={false} />
      );
      await flushMicrotasks();
      expect(oldPlan.destroyMock).not.toHaveBeenCalled();
      oldPlan.loadingDeferred.resolve(oldPlan.pdf);
      await flushMicrotasks();
      expect(oldPlan.destroyMock).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(stageRuntime, stage.view);
    }
  });

  it("T04 late fetch promise and arrayBuffer completion after replacement stay pre-document inert", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const oldResponseIndex = await startFetch(runtime);
      const oldResponse = runtime.responses[oldResponseIndex];
      view.rerender(<Harness blobUrl="blob:two" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      const replacementResponseStart = runtime.responses.length - 1;
      oldResponse.fetch.resolve(oldResponse.response);
      await flushMicrotasks();
      expect(oldResponse.buffer.settled()).toBe(false);
      expect(runtime.loadCalls).toHaveLength(0);
      await runtime.resolveAllResponses(replacementResponseStart);
      await runtime.resolveLoad();
      expect(runtime.pdfJsModule.getDocument).toHaveBeenCalledTimes(1);
      oldResponse.buffer.resolve(new ArrayBuffer(8));
      await flushMicrotasks();
      expect(runtime.pdfJsModule.getDocument).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T04b old arrayBuffer completion after replacement cannot start the old pdf.js load", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const oldResponseIndex = await startFetch(runtime);
      const oldResponse = runtime.responses[oldResponseIndex];
      await runtime.resolveFetch(oldResponseIndex);
      expect(oldResponse.buffer.settled()).toBe(false);
      const replacementResponseStart = runtime.responses.length;
      view.rerender(<Harness blobUrl="blob:buffer-replacement" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      oldResponse.buffer.resolve(new ArrayBuffer(8));
      await flushMicrotasks();
      expect(runtime.loadCalls).toHaveLength(0);
      await runtime.resolveAllResponses(replacementResponseStart);
      await runtime.resolveLoad();
      expect(runtime.pdfJsModule.getDocument).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T05 late loadPdfJs completion after replacement cannot create an unowned loading task", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      await startFetch(runtime);
      await runtime.resolveAllResponses();
      expect(runtime.loadCalls).toHaveLength(1);
      const oldLoad = runtime.loadCalls[0];
      const replacementResponseStart = runtime.responses.length;
      view.rerender(<Harness blobUrl="blob:two" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      oldLoad.resolve(runtime.pdfJsModule);
      await flushMicrotasks();
      const staleDocumentCalls = runtime.getDocumentCallCount();
      await runtime.resolveAllResponses(replacementResponseStart);
      await runtime.resolveLoad(runtime.loadCalls.length - 1);
      const observed = {
        loadingTasksBeforeRetirement: runtime.snapshot().loadingTasks,
        replacementPlans: runtime.usedPlans.length,
        staleLoadingTaskDestroyed: runtime.usedPlans.length > 1 ? runtime.usedPlans[0].isDestroyed() : null,
        staleDocumentCalls
      };
      expect(observed).toEqual({
        loadingTasksBeforeRetirement: 1,
        replacementPlans: 1,
        staleLoadingTaskDestroyed: null,
        staleDocumentCalls: 0
      });
    } finally {
      await closeRuntimeAllowingExpectedLeaks(runtime, view);
    }
  });

  it("T05b late loadPdfJs completion after unmount cannot create an unowned loading task", async () => {
    const unmountRuntime = createPdfRuntime();
    const unmountError = vi.fn();
    const unmount = renderHarness(unmountRuntime, "blob:unmount", unmountError);
    try {
      await startFetch(unmountRuntime);
      await unmountRuntime.resolveAllResponses();
      const load = unmountRuntime.loadCalls[0];
      unmount.view.unmount();
      load.resolve(unmountRuntime.pdfJsModule);
      await flushMicrotasks();
      const observed = {
        documentCalls: unmountRuntime.getDocumentCallCount(),
        loadingTasksBeforeRetirement: unmountRuntime.snapshot().loadingTasks,
        onErrorCalls: unmountError.mock.calls.length
      };
      expect(observed).toEqual({
        documentCalls: 0,
        loadingTasksBeforeRetirement: 0,
        onErrorCalls: 0
      });
    } finally {
      await closeRuntimeAllowingExpectedLeaks(unmountRuntime, unmount.view);
    }
  });

  it("T06 stale fetch, arrayBuffer, and pdf.js rejection paths stay inert after replacement", async () => {
    const stages = ["fetch", "buffer", "load"] as const;
    for (const stage of stages) {
      const runtime = createPdfRuntime();
      const onError = vi.fn();
      const { view } = renderHarness(runtime, "blob:one", onError);
      try {
        const oldResponseIndex = await startFetch(runtime);
        const oldResponse = runtime.responses[oldResponseIndex];
        let oldLoad: TrackedDeferred<PdfJsModule> | undefined;
        if (stage !== "fetch") {
          oldResponse.fetch.resolve(oldResponse.response);
          await flushMicrotasks();
        }
        if (stage === "load") {
          oldResponse.buffer.resolve(new ArrayBuffer(8));
          await flushMicrotasks();
          oldLoad = runtime.loadCalls[0];
        }
        view.rerender(<Harness blobUrl={`blob:${stage}-replacement`} onError={vi.fn()} ports={runtime.ports} />);
        await flushMicrotasks();
        if (stage === "fetch") {
          oldResponse.fetch.reject(new Error("stale fetch"));
        } else if (stage === "buffer") {
          oldResponse.buffer.reject(new Error("stale buffer"));
        } else {
          oldLoad!.reject(new Error("stale load"));
        }
        await flushMicrotasks();
        expect(onError).not.toHaveBeenCalled();
      } finally {
        await closeRuntime(runtime, view);
      }
    }
  });

  it("T07 current fetch, HTTP, arrayBuffer, and pdf.js failures report once", async () => {
    const currentFailure = async (kind: "fetch" | "http" | "buffer" | "load") => {
      const runtime = createPdfRuntime();
      const onError = vi.fn();
      if (kind === "http") {
        runtime.setNextResponseOk(false);
      }
      const { view } = renderHarness(runtime, `blob:${kind}`, onError);
      try {
        const responseIndex = await startFetch(runtime);
        if (kind === "fetch") {
          await runtime.rejectFetch(responseIndex);
        } else {
          await runtime.resolveFetch(responseIndex);
          if (kind === "buffer") {
            runtime.responses[responseIndex].buffer.reject(new Error("current buffer"));
            await flushMicrotasks();
          } else if (kind === "load") {
            runtime.responses[responseIndex].buffer.resolve(new ArrayBuffer(8));
            await flushMicrotasks();
            await runtime.rejectLoad();
          }
        }
        expect(view.getByTestId("render-state")).toHaveTextContent("failed");
        expect(onError).toHaveBeenCalledTimes(1);
      } finally {
        await closeRuntime(runtime, view);
      }
    };

    for (const kind of ["fetch", "http", "buffer", "load"] as const) {
      await currentFailure(kind);
    }
  });

  it("T08 loading-task rejection reports current failure but stale rejection is inert", async () => {
    const currentRuntime = createPdfRuntime();
    const currentError = vi.fn();
    const current = renderHarness(currentRuntime, "blob:current", currentError);
    try {
      await startFetch(currentRuntime);
      await currentRuntime.resolveAllResponses();
      await currentRuntime.resolveLoad();
      const plan = currentRuntime.usedPlans[0];
      plan.loadingDeferred.reject(new Error("current loading failure"));
      await flushMicrotasks();
      expect(current.view.getByTestId("render-state")).toHaveTextContent("failed");
      expect(currentError).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(currentRuntime, current.view);
    }

    const staleRuntime = createPdfRuntime();
    const staleError = vi.fn();
    const stale = renderHarness(staleRuntime, "blob:old", staleError);
    try {
      const oldPlan = await advanceToLoadingTask(staleRuntime);
      stale.view.rerender(<Harness blobUrl="blob:new" onError={vi.fn()} ports={staleRuntime.ports} />);
      await flushMicrotasks();
      oldPlan.loadingDeferred.reject(new Error("stale loading failure"));
      await flushMicrotasks();
      expect(staleError).not.toHaveBeenCalled();
    } finally {
      await closeRuntime(staleRuntime, stale.view);
    }
  });

  it("T09 first-page and later-page failure paths stay owned by the current pipeline", async () => {
    const currentRuntime = createPdfRuntime();
    const currentError = vi.fn();
    const current = renderHarness(currentRuntime, "blob:page", currentError);
    try {
      const plan = await advanceToLoadingTask(currentRuntime);
      plan.loadingDeferred.resolve(plan.pdf);
      await flushMicrotasks();
      await currentRuntime.rejectPage(plan, 1);
      expect(current.view.getByTestId("render-state")).toHaveTextContent("failed");
      expect(currentError).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(currentRuntime, current.view);
    }

    const laterRuntime = createPdfRuntime();
    const laterError = vi.fn();
    const later = renderHarness(laterRuntime, "blob:later", laterError);
    try {
      const plan = await advanceToLoadingTask(laterRuntime);
      const firstRender = await advanceToFirstRenderTask(laterRuntime, plan);
      await laterRuntime.resolveRender(firstRender);
      await laterRuntime.rejectPage(plan, 2);
      expect(later.view.getByTestId("render-state")).toHaveTextContent("failed");
      expect(laterError).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(laterRuntime, later.view);
    }

    const staleRuntime = createPdfRuntime();
    const staleError = vi.fn();
    const stale = renderHarness(staleRuntime, "blob:old-page", staleError);
    try {
      const oldPlan = await advanceToLoadingTask(staleRuntime);
      oldPlan.loadingDeferred.resolve(oldPlan.pdf);
      await flushMicrotasks();
      await staleRuntime.resolvePage(oldPlan, 1);
      staleRuntime.flushFrames();
      await flushMicrotasks();
      const oldRender = oldPlan.renderTasks[0];
      stale.view.rerender(<Harness blobUrl="blob:new-page" onError={vi.fn()} ports={staleRuntime.ports} />);
      await flushMicrotasks();
      oldRender.deferred.reject(new Error("stale render"));
      await flushMicrotasks();
      expect(staleError).not.toHaveBeenCalled();
      stale.view.rerender(
        <Harness blobUrl="blob:new-page" onError={vi.fn()} ports={staleRuntime.ports} showStage={false} />
      );
      await flushMicrotasks();
    } finally {
      await closeRuntime(staleRuntime, stale.view);
    }

    const stalePageRuntime = createPdfRuntime();
    const stalePageError = vi.fn();
    const stalePage = renderHarness(stalePageRuntime, "blob:old-page-pending", stalePageError);
    try {
      const oldPlan = await advanceToLoadingTask(stalePageRuntime);
      oldPlan.loadingDeferred.resolve(oldPlan.pdf);
      await flushMicrotasks();
      expect(oldPlan.pageDeferreds.has(1)).toBe(true);
      stalePage.view.rerender(
        <Harness blobUrl="blob:new-page-pending" onError={vi.fn()} ports={stalePageRuntime.ports} />
      );
      await flushMicrotasks();
      await stalePageRuntime.rejectPage(oldPlan, 1, new Error("stale page"));
      expect(stalePageError).not.toHaveBeenCalled();
      stalePage.view.rerender(
        <Harness blobUrl="blob:new-page-pending" onError={vi.fn()} ports={stalePageRuntime.ports} showStage={false} />
      );
      await flushMicrotasks();
    } finally {
      await closeRuntime(stalePageRuntime, stalePage.view);
    }

    const staleLaterRuntime = createPdfRuntime();
    const staleLaterError = vi.fn();
    const staleLater = renderHarness(staleLaterRuntime, "blob:old-later-pending", staleLaterError);
    try {
      const oldPlan = await advanceToLoadingTask(staleLaterRuntime);
      const firstRender = await advanceToFirstRenderTask(staleLaterRuntime, oldPlan);
      await staleLaterRuntime.resolveRender(firstRender);
      expect(oldPlan.pageDeferreds.has(2)).toBe(true);
      staleLater.view.rerender(
        <Harness blobUrl="blob:new-later-pending" onError={vi.fn()} ports={staleLaterRuntime.ports} />
      );
      await flushMicrotasks();
      await staleLaterRuntime.rejectPage(oldPlan, 2, new Error("stale later page"));
      expect(staleLaterError).not.toHaveBeenCalled();
      staleLater.view.rerender(
        <Harness
          blobUrl="blob:new-later-pending"
          onError={vi.fn()}
          ports={staleLaterRuntime.ports}
          showStage={false}
        />
      );
      await flushMicrotasks();
    } finally {
      await closeRuntime(staleLaterRuntime, staleLater.view);
    }
  });

  it("T10 pending first-page cleanup and stage removal leave no render or error side effects", async () => {
    const runtime = createPdfRuntime();
    const onError = vi.fn();
    const { view } = renderHarness(runtime, "blob:one", onError);
    try {
      const plan = await advanceToLoadingTask(runtime);
      plan.loadingDeferred.resolve(plan.pdf);
      await flushMicrotasks();
      view.unmount();
      await runtime.resolvePage(plan, 1);
      runtime.flushFrames();
      await flushMicrotasks();
      expect(plan.renderTasks).toHaveLength(0);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await closeRuntime(runtime, view);
    }

    const stageRuntime = createPdfRuntime();
    const stage = renderHarness(stageRuntime, "blob:stage", vi.fn());
    try {
      await startFetch(stageRuntime);
      const observer = stageRuntime.observers[0];
      stage.view.rerender(
        <Harness blobUrl="blob:stage" onError={vi.fn()} ports={stageRuntime.ports} showStage={false} />
      );
      await flushMicrotasks();
      expect(observer.disconnectMock).toHaveBeenCalledTimes(1);
      expect(stageRuntime.liveObservers()).toHaveLength(0);
    } finally {
      await closeRuntime(stageRuntime, stage.view);
    }
  });

  it("T11 later-page cleanup prevents unowned renders and cancels existing work once", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const plan = await advanceToLoadingTask(runtime);
      const firstRender = await advanceToFirstRenderTask(runtime, plan);
      await runtime.resolveRender(firstRender);
      expect(plan.pageDeferreds.has(2)).toBe(true);
      view.unmount();
      await runtime.resolvePage(plan, 2);
      await flushMicrotasks();
      expect(plan.renderTasks).toHaveLength(1);
      expect(firstRender.cancelMock).toHaveBeenCalledTimes(1);
      expect(runtime.liveRenderTasks()).toHaveLength(0);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T12 active render cleanup cancels once; late resolve/reject is inert while current rejection reports once", async () => {
    const runtime = createPdfRuntime();
    const onError = vi.fn();
    const { view } = renderHarness(runtime, "blob:one", onError);
    try {
      const plan = await advanceToLoadingTask(runtime);
      const renderTask = await advanceToFirstRenderTask(runtime, plan);
      view.unmount();
      expect(renderTask.cancelMock).toHaveBeenCalledTimes(1);
      await runtime.resolveRender(renderTask);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await closeRuntime(runtime, view);
    }

    const rejectRuntime = createPdfRuntime();
    const rejectError = vi.fn();
    const reject = renderHarness(rejectRuntime, "blob:reject-after-cleanup", rejectError);
    try {
      const plan = await advanceToLoadingTask(rejectRuntime);
      const renderTask = await advanceToFirstRenderTask(rejectRuntime, plan);
      reject.view.unmount();
      await rejectRuntime.rejectRender(renderTask, new Error("late render rejection"));
      expect(rejectError).not.toHaveBeenCalled();
    } finally {
      await closeRuntime(rejectRuntime, reject.view);
    }

    const failureRuntime = createPdfRuntime();
    const failure = renderHarness(failureRuntime);
    try {
      const failurePlan = await advanceToLoadingTask(failureRuntime);
      const failureTask = await advanceToFirstRenderTask(failureRuntime, failurePlan);
      await failureRuntime.rejectRender(failureTask);
      expect(failure.view.getByTestId("render-state")).toHaveTextContent("failed");
      expect(failure.onError).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(failureRuntime, failure.view);
    }
  });

  it("T13 source replacement makes old page/render completion inert and preserves replacement ownership", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const oldPlan = await advanceToLoadingTask(runtime);
      const oldRender = await advanceToFirstRenderTask(runtime, oldPlan);
      runtime.enqueuePlan(1);
      const replacementResponseStart = runtime.responses.length;
      view.rerender(<Harness blobUrl="blob:two" onError={vi.fn()} ports={runtime.ports} />);
      await flushMicrotasks();
      await runtime.resolveAllResponses(replacementResponseStart);
      await runtime.resolveLoad(runtime.loadCalls.length - 1);
      const replacement = runtime.usedPlans[runtime.usedPlans.length - 1];
      replacement.loadingDeferred.resolve(replacement.pdf);
      await flushMicrotasks();
      await runtime.resolvePage(replacement, 1);
      runtime.flushFrames();
      await flushMicrotasks();
      const replacementRender = replacement.renderTasks[0];

      oldRender.deferred.resolve(undefined);
      await flushMicrotasks();
      expect(view.getByTestId("render-state")).toHaveTextContent("loading");
      expect(replacementRender.cancelMock).not.toHaveBeenCalled();
      await runtime.resolveRender(replacementRender);
      expect(view.getByTestId("render-state")).toHaveTextContent("ready");
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T14a cleanup before the first pre-render frame leaves no render continuation", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const plan = await advanceToLoadingTask(runtime);
      plan.loadingDeferred.resolve(plan.pdf);
      await flushMicrotasks();
      await runtime.resolvePage(plan, 1);
      expect(runtime.pendingFrameCount()).toBe(1);
      view.unmount();
      runtime.flushFrames();
      expect(plan.renderTasks).toHaveLength(0);
      await flushMicrotasks();
      expect(runtime.pendingFrameCount()).toBe(0);
      expect(plan.renderTasks).toHaveLength(0);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T14b cleanup between pre-render frames leaves the second continuation inert", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      const plan = await advanceToLoadingTask(runtime);
      plan.loadingDeferred.resolve(plan.pdf);
      await flushMicrotasks();
      await runtime.resolvePage(plan, 1);
      expect(runtime.flushFrames(1)).toBe(1);
      expect(runtime.pendingFrameCount()).toBe(1);
      view.unmount();
      runtime.flushFrames();
      expect(plan.renderTasks).toHaveLength(0);
      await flushMicrotasks();
      expect(runtime.pendingFrameCount()).toBe(0);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T14c queued post-ready callback is inert after replacement", async () => {
    const readyRuntime = createPdfRuntime();
    readyRuntime.enqueuePlan(2);
    const ready = renderHarness(readyRuntime);
    try {
      const readyPlan = await advanceToLoadingTask(readyRuntime);
      readyPlan.loadingDeferred.resolve(readyPlan.pdf);
      await flushMicrotasks();
      await readyRuntime.resolvePage(readyPlan, 1);
      readyRuntime.flushFrames();
      await flushMicrotasks();
      const firstRender = readyPlan.renderTasks[0];
      await readyRuntime.resolveRender(firstRender);
      await readyRuntime.resolvePage(readyPlan, 2);
      readyRuntime.flushFrames();
      await flushMicrotasks();
      const secondRender = readyPlan.renderTasks[1];
      await readyRuntime.resolveRender(secondRender);
      await flushMicrotasks();
      expect(ready.view.getByTestId("render-state")).toHaveTextContent("ready");
      expect(readyRuntime.pendingFrameCount()).toBe(1);

      const scrollElement = ready.view.container.querySelector<HTMLDivElement>(".pdf-canvas-scroll");
      if (!scrollElement) {
        throw new Error("PDF scroll element was not mounted.");
      }
      const pageElements = ready.view.container.querySelectorAll<HTMLDivElement>(".pdf-canvas-page");
      Object.defineProperty(scrollElement, "clientHeight", { configurable: true, value: 200 });
      Object.defineProperty(scrollElement, "scrollTop", { configurable: true, writable: true, value: 200 });
      Object.defineProperty(pageElements[0], "offsetTop", { configurable: true, value: 0 });
      Object.defineProperty(pageElements[0], "offsetHeight", { configurable: true, value: 100 });
      Object.defineProperty(pageElements[1], "offsetTop", { configurable: true, value: 300 });
      Object.defineProperty(pageElements[1], "offsetHeight", { configurable: true, value: 100 });

      const replacementResponseStart = readyRuntime.responses.length;
      ready.view.rerender(<Harness blobUrl="blob:replacement" onError={vi.fn()} ports={readyRuntime.ports} />);
      await flushMicrotasks();
      const currentPageAfterReplacement = ready.view.getByTestId("current-page").textContent;
      const replacementResponseCountBeforeOldCallback = readyRuntime.responses.length;
      expect(replacementResponseCountBeforeOldCallback).toBeGreaterThan(replacementResponseStart);
      expect(readyRuntime.pendingFrameCount()).toBe(1);

      readyRuntime.flushFrames();
      await flushMicrotasks();
      const currentPageAfterOldCallback = ready.view.getByTestId("current-page").textContent;
      const replacementResponseCountAfterOldCallback = readyRuntime.responses.length;
      const observed = {
        currentPageAfterOldCallback,
        currentPageAfterReplacement,
        replacementResponseCountAfterOldCallback
      };
      expect(observed).toEqual({
        currentPageAfterOldCallback: "1",
        currentPageAfterReplacement: "1",
        replacementResponseCountAfterOldCallback: replacementResponseCountBeforeOldCallback
      });
    } finally {
      await closeRuntime(readyRuntime, ready.view);
    }
  });

  it("T15 disconnected ResizeObserver callbacks cannot restart a replacement pipeline, while current ready notifications retain layout ownership", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    const replacementRuntime = createPdfRuntime();
    try {
      await startFetch(runtime);
      expect(runtime.observers.length).toBeGreaterThan(0);
      const oldObserver = runtime.observers[runtime.observers.length - 1];
      const replacementPlan = replacementRuntime.enqueuePlan(1);
      const replacementStart = replacementRuntime.responses.length;
      view.rerender(<Harness blobUrl="blob:two" onError={vi.fn()} ports={replacementRuntime.ports} />);
      await flushMicrotasks();
      expect(oldObserver.disconnectMock).toHaveBeenCalledTimes(1);
      oldObserver.callback([], oldObserver);
      await flushMicrotasks();
      expect(replacementRuntime.responses.length).toBeGreaterThan(replacementStart);
      await replacementRuntime.resolveAllResponses(replacementStart);
      await replacementRuntime.resolveLoad();
      replacementPlan.loadingDeferred.resolve(replacementPlan.pdf);
      await flushMicrotasks();
      await replacementRuntime.resolvePage(replacementPlan, 1);
      replacementRuntime.flushFrames();
      await flushMicrotasks();
      const renderTask = replacementPlan.renderTasks[0];
      await replacementRuntime.resolveRender(renderTask);
      await flushMicrotasks();
      expect(replacementRuntime.liveObservers()).toHaveLength(1);
      const fetchCountBeforeOldCallback = replacementRuntime.responses.length;
      oldObserver.callback([], oldObserver);
      await flushMicrotasks();
      expect(replacementRuntime.responses).toHaveLength(fetchCountBeforeOldCallback);
    } finally {
      await closeRuntimeAllowingExpectedLeaks(runtime, view);
      await closeRuntimeAllowingExpectedLeaks(replacementRuntime);
    }
  });

  it("T15b current ready ResizeObserver notification owns the layout restart", async () => {
    const runtime = createPdfRuntime();
    const { view } = renderHarness(runtime);
    try {
      runtime.enqueuePlan(1);
      const plan = await advanceToLoadingTask(runtime);
      const renderTask = await advanceToFirstRenderTask(runtime, plan);
      await runtime.resolveRender(renderTask);
      await flushMicrotasks();
      const observer = runtime.observers.find((candidate) => candidate.isActive());
      expect(observer).toBeDefined();
      const responseCountBeforeResize = runtime.responses.length;
      observer!.callback([], observer!);
      await flushMicrotasks();
      expect(view.getByTestId("render-state")).toHaveTextContent("loading");
      expect(runtime.responses.length).toBeGreaterThan(responseCountBeforeResize);
    } finally {
      await closeRuntime(runtime, view);
    }
  });

  it("T16 current fetch failure and StrictMode cleanup leave no pending tasks, observers, or frames", async () => {
    const runtime = createPdfRuntime();
    const onError = vi.fn();
    runtime.setNextResponseOk(false);
    const { view } = renderHarness(runtime, "blob:one", onError);
    try {
      const responseIndex = await startFetch(runtime);
      await runtime.resolveFetch(responseIndex);
      await flushMicrotasks();
      expect(view.getByTestId("render-state")).toHaveTextContent("failed");
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      await closeRuntime(runtime, view);
    }

    const strictRuntime = createPdfRuntime();
    const strict = renderHarness(strictRuntime, "blob:strict", vi.fn(), true);
    try {
      strict.view.unmount();
    } finally {
      await closeRuntime(strictRuntime, strict.view);
      strictRuntime.observers.forEach((observer) => {
        expect(observer.observeMock).toHaveBeenCalledTimes(1);
        expect(observer.disconnectMock).toHaveBeenCalledTimes(1);
      });
    }
  });
});
