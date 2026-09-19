import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPreviewStage } from "./PdfPreviewStage";
import type { PdfPreviewRuntimePorts } from "./ports";
import { usePdfPreviewInteraction } from "./usePdfPreviewInteraction";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createFakePdfEnvironment(pageCount = 2) {
  const destroy = vi.fn();
  const cancel = vi.fn();
  const loadingDeferred = createDeferred<{ numPages: number; getPage: ReturnType<typeof vi.fn> }>();
  const renderDeferreds: Array<Deferred<void>> = [];
  const render = vi.fn(() => {
    const deferred = createDeferred<void>();
    renderDeferreds.push(deferred);
    return {
      cancel,
      promise: deferred.promise
    };
  });
  const getPage = vi.fn(async () => ({
    getBaseSize: () => ({ width: 100, height: 140 }),
    render
  }));
  const pdf = { numPages: pageCount, getPage };
  const loadingTask = {
    promise: loadingDeferred.promise,
    destroy
  };
  const getDocument = vi.fn(() => loadingTask);
  const loadPdfJs = vi.fn(async () => ({ getDocument }));
  const fetchImpl = vi.fn(async (_input?: unknown, _init?: unknown): Promise<Response> =>
    new Response(new ArrayBuffer(8), { status: 200 })
  );

  return {
    cancel,
    destroy,
    fetchImpl,
    getDocument,
    loadPdfJs,
    loadingDeferred,
    pdf,
    render,
    renderDeferreds
  };
}

function createTestPdfPreviewPorts(
  deps: ReturnType<typeof createFakePdfEnvironment>,
  createResizeObserver: PdfPreviewRuntimePorts["createResizeObserver"]
): PdfPreviewRuntimePorts {
  return {
    loadPdfJs: deps.loadPdfJs,
    fetch: (input, init) => deps.fetchImpl(input, init),
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    getDevicePixelRatio: () => 1,
    createResizeObserver
  };
}

function Harness({
  blobUrl,
  onError = vi.fn(),
  ports,
  showStage = true
}: {
  blobUrl: string;
  onError?: () => void;
  ports: PdfPreviewRuntimePorts;
  showStage?: boolean;
}) {
  const interaction = usePdfPreviewInteraction({
    blobUrl,
    onError,
    ports
  });

  return (
    <>
      <output data-testid="render-state">{interaction.controls.renderState}</output>
      <output data-testid="page-count">{String(interaction.controls.pageCount ?? "")}</output>
      {showStage ? <PdfPreviewStage fileName="sample.pdf" interaction={interaction} /> : null}
    </>
  );
}

async function waitForPdfCanvas() {
  await waitFor(() => {
    expect(document.querySelector("canvas.pdf-canvas")).toBeTruthy();
  });
}

describe("usePdfPreviewInteraction", () => {
  let resizeDisconnect: ReturnType<typeof vi.fn>;
  let resizeObserve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resizeDisconnect = vi.fn();
    resizeObserve = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn()
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createPorts(deps: ReturnType<typeof createFakePdfEnvironment>): PdfPreviewRuntimePorts {
    return createTestPdfPreviewPorts(deps, (callback) => {
      class FakeResizeObserver {
        constructor(_callback: ResizeObserverCallback) {}

        observe = resizeObserve;
        disconnect = resizeDisconnect;
      }
      return new FakeResizeObserver(callback);
    });
  }

  it("destroys the loading task on unmount and blobUrl replacement", async () => {
    const deps = createFakePdfEnvironment();
    const ports = createPorts(deps);
    const { unmount } = render(<Harness blobUrl="blob:one" ports={ports} />);

    await waitForPdfCanvas();
    deps.loadingDeferred.resolve(deps.pdf);
    await waitFor(() => expect(deps.getDocument).toHaveBeenCalled());

    unmount();
    await waitFor(() => expect(deps.destroy).toHaveBeenCalledTimes(1));

    const nextDeps = createFakePdfEnvironment();
    const nextPorts = createPorts(nextDeps);
    const view = render(<Harness blobUrl="blob:one" ports={nextPorts} />);
    await waitForPdfCanvas();
    nextDeps.loadingDeferred.resolve(nextDeps.pdf);
    await waitFor(() => expect(nextDeps.getDocument).toHaveBeenCalled());
    view.rerender(<Harness blobUrl="blob:two" ports={nextPorts} />);
    await waitFor(() => expect(nextDeps.destroy).toHaveBeenCalledTimes(1));
  });

  it("cancels in-flight render tasks on unmount and blobUrl replacement", async () => {
    const deps = createFakePdfEnvironment(1);
    const ports = createPorts(deps);
    const { unmount } = render(<Harness blobUrl="blob:one" ports={ports} />);

    await waitForPdfCanvas();
    deps.loadingDeferred.resolve(deps.pdf);
    await waitFor(() => expect(deps.render).toHaveBeenCalled());
    expect(deps.cancel).not.toHaveBeenCalled();

    unmount();
    expect(deps.cancel).toHaveBeenCalled();

    const nextDeps = createFakePdfEnvironment(1);
    const nextPorts = createPorts(nextDeps);
    const view = render(<Harness blobUrl="blob:one" ports={nextPorts} />);
    await waitForPdfCanvas();
    nextDeps.loadingDeferred.resolve(nextDeps.pdf);
    await waitFor(() => expect(nextDeps.render).toHaveBeenCalled());
    view.rerender(<Harness blobUrl="blob:two" ports={nextPorts} />);
    await waitFor(() => expect(nextDeps.cancel).toHaveBeenCalled());
  });

  it("disconnects its ResizeObserver on unmount", () => {
    const deps = createFakePdfEnvironment();
    const ports = createPorts(deps);
    const { unmount } = render(<Harness blobUrl="blob:one" ports={ports} />);
    expect(resizeObserve).toHaveBeenCalled();
    unmount();
    expect(resizeDisconnect).toHaveBeenCalled();
  });

  it("attaches its ResizeObserver when the scroll stage mounts after the hook", async () => {
    const deps = createFakePdfEnvironment();
    const ports = createPorts(deps);
    const { rerender } = render(<Harness blobUrl="blob:one" ports={ports} showStage={false} />);
    expect(resizeObserve).not.toHaveBeenCalled();

    rerender(<Harness blobUrl="blob:one" ports={ports} showStage={true} />);
    await waitFor(() => expect(resizeObserve).toHaveBeenCalled());
  });

  it("resets zoom, page, and scroll state when the blobUrl changes", async () => {
    const deps = createFakePdfEnvironment(1);
    const ports = createPorts(deps);
    const { getByLabelText, getByTestId, rerender } = render(<Harness blobUrl="blob:one" ports={ports} />);
    await waitForPdfCanvas();
    deps.loadingDeferred.resolve(deps.pdf);
    await waitFor(() => expect(deps.renderDeferreds.length).toBeGreaterThan(0));
    for (const deferred of deps.renderDeferreds) {
      deferred.resolve();
    }

    await waitFor(() => expect(getByTestId("render-state")).toHaveTextContent("ready"));
    fireEvent.click(getByLabelText("Zoom PDF in"));
    const scroll = getByLabelText("PDF preview sample.pdf").querySelector(".pdf-canvas-scroll") as HTMLDivElement;
    scroll.scrollLeft = 24;
    scroll.scrollTop = 12;

    rerender(<Harness blobUrl="blob:two" ports={ports} />);
    expect(getByTestId("page-count")).toHaveTextContent("");
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollTop).toBe(0);
    expect(getByLabelText("Fit PDF to width")).toHaveAttribute("aria-pressed", "true");
  });

  it("does not restart pdf.js load when the stage re-renders during fetch", async () => {
    const deps = createFakePdfEnvironment(1);
    const ports = createPorts(deps);
    const { getByTestId, rerender } = render(<Harness blobUrl="blob:one" ports={ports} />);

    await waitForPdfCanvas();
    deps.loadingDeferred.resolve(deps.pdf);
    await waitFor(() => expect(deps.render).toHaveBeenCalled());
    expect(deps.destroy).not.toHaveBeenCalled();

    rerender(<Harness blobUrl="blob:one" ports={ports} />);
    expect(deps.destroy).not.toHaveBeenCalled();

    for (const deferred of deps.renderDeferreds) {
      deferred.resolve();
    }

    await waitFor(() => expect(getByTestId("render-state")).toHaveTextContent("ready"));
  });

  it("does not apply a stale render completion after blobUrl replacement", async () => {
    const deps = createFakePdfEnvironment(1);
    const ports = createPorts(deps);
    const onError = vi.fn();
    const { getByTestId, rerender } = render(<Harness blobUrl="blob:one" ports={ports} onError={onError} />);

    await waitForPdfCanvas();
    deps.loadingDeferred.resolve(deps.pdf);
    rerender(<Harness blobUrl="blob:two" ports={ports} onError={onError} />);
    deps.renderDeferreds[0]?.resolve();

    await waitFor(() => expect(getByTestId("render-state")).toHaveTextContent("loading"));
    expect(onError).not.toHaveBeenCalled();
  });
});
