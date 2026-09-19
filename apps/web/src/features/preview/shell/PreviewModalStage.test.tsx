import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileEntry, buildFilePreview } from "../../../test/files";
import type { PreviewModalRuntimePorts } from "./ports";
import { PreviewModalStage } from "./PreviewModalStage";

const imageStageMock = vi.fn(({ alt }: { alt: string }) => <div data-testid="image-preview-stage">{alt}</div>);
const pdfStageMock = vi.fn(({ fileName }: { fileName: string }) => <div data-testid="pdf-preview-stage">{fileName}</div>);
const videoStageMock = vi.fn(({ fileName }: { fileName: string }) => <div data-testid="video-preview-stage">{fileName}</div>);

vi.mock("../image", () => ({
  ImagePreviewStage: (props: { alt: string }) => imageStageMock(props),
  useImagePreviewInteraction: () => ({
    stage: {
      stageRef: vi.fn(),
      hasCustomZoom: false,
      imageStyle: undefined,
      onImageLoad: vi.fn(),
      onImageError: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerEnd: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
      onWheel: vi.fn(),
      consumeSuppressedAdvance: vi.fn(() => false)
    },
    controls: {
      hasCustomZoom: false,
      toggleFitMode: vi.fn(),
      showOriginalSize: vi.fn(),
      zoomLabel: "100%",
      zoomScale: 1
    },
    failed: false
  }),
  resolveImageEdgeNavigationIntent: vi.fn()
}));

vi.mock("../pdf", () => ({
  PdfPreviewStage: (props: { fileName: string }) => pdfStageMock(props),
  usePdfPreviewInteraction: () => ({
    fileName: "fixture.pdf",
    interaction: {}
  })
}));

vi.mock("../video", () => ({
  VideoPreviewStage: (props: { fileName: string }) => videoStageMock(props),
  useVideoPreviewInteraction: () => ({
    fileName: "fixture.mp4",
    interaction: {}
  })
}));

vi.mock("../../../components/MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>
}));

function createTestPorts(overrides: Partial<PreviewModalRuntimePorts> = {}): PreviewModalRuntimePorts {
  const timeouts = new Map<number, () => void>();
  let nextTimeoutId = 1;

  return {
    pdf: {
      loadPdfJs: vi.fn(),
      fetch: vi.fn(),
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      getDevicePixelRatio: () => 1,
      createResizeObserver: () => undefined
    },
    video: {
      setTimeout: (callback, _delayMs) => {
        const timeoutId = nextTimeoutId++;
        timeouts.set(timeoutId, callback);
        return timeoutId;
      },
      clearTimeout: (timeoutId) => {
        if (timeoutId !== undefined) {
          timeouts.delete(timeoutId);
        }
      },
      getLocationHref: () => "https://davora.test/files"
    },
    setTimeout: (callback, _delayMs) => {
      const timeoutId = nextTimeoutId++;
      timeouts.set(timeoutId, callback);
      return timeoutId;
    },
    clearTimeout: (timeoutId) => {
      if (timeoutId !== undefined) {
        timeouts.delete(timeoutId);
      }
    },
    getLocationHref: () => "https://davora.test/files",
    startOriginalFileOpen: vi.fn(() => ({ completion: Promise.resolve(), cancel: vi.fn() })),
    addWindowKeydownListener: vi.fn(() => vi.fn()),
    loadAudioPreviewPosition: vi.fn(() => undefined),
    saveAudioPreviewPosition: vi.fn(),
    clearAudioPreviewPosition: vi.fn(),
    ...overrides
  };
}

function buildProps(overrides: Partial<ComponentProps<typeof PreviewModalStage>> = {}) {
  return {
    open: true,
    offline: false,
    loading: false,
    cacheState: {
      source: "none" as const,
      refreshing: false,
      stale: false,
      updateReady: false
    },
    fileSizeDisplayMode: "human" as const,
    imageFitMode: "fit" as const,
    maxCacheableFileSizeBytes: 50_000_000,
    onImageFitModeChange: vi.fn(),
    onClose: vi.fn(),
    ports: createTestPorts(),
    ...overrides
  };
}

describe("PreviewModalStage", () => {
  beforeEach(() => {
    imageStageMock.mockClear();
    pdfStageMock.mockClear();
    videoStageMock.mockClear();
  });

  afterEach(cleanup);
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when closed", () => {
    const { container } = render(<PreviewModalStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows open shell title and dialog aria label", () => {
    render(
      <PreviewModalStage
        {...buildProps({
          file: buildFilePreview("Projects/roadmap.txt", { viewer: "text", name: "roadmap.txt" })
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Preview roadmap.txt/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("heading", { name: "roadmap.txt" })).toBeInTheDocument();
    expect(screen.getByText("Text preview")).toBeInTheDocument();
  });

  it("applies immersive classes for image previews", () => {
    render(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:image",
          file: buildFilePreview("Archive/photo.png", {
            viewer: "image",
            name: "photo.png",
            mimeType: "image/png"
          })
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Preview photo.png/i });
    expect(dialog.className).toContain("preview-modal-immersive");
    expect(document.querySelector(".preview-scrim-immersive")).toBeTruthy();
  });

  it("composes image, pdf, and video child stages when enabled", () => {
    const { rerender } = render(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:image",
          file: buildFilePreview("Archive/photo.png", {
            viewer: "image",
            name: "photo.png",
            mimeType: "image/png"
          })
        })}
      />
    );
    expect(screen.getByTestId("image-preview-stage")).toHaveTextContent("photo.png");

    rerender(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:pdf",
          file: buildFilePreview("Docs/report.pdf", {
            viewer: "pdf",
            name: "report.pdf",
            mimeType: "application/pdf"
          })
        })}
      />
    );
    expect(screen.getByTestId("pdf-preview-stage")).toHaveTextContent("report.pdf");

    rerender(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:video",
          file: buildFilePreview("Media/clip.mp4", {
            viewer: "video",
            name: "clip.mp4",
            mimeType: "video/mp4"
          })
        })}
      />
    );
    expect(screen.getByTestId("video-preview-stage")).toHaveTextContent("clip.mp4");
  });

  it("projects unsupported fallback actions", () => {
    const onDownload = vi.fn();
    render(
      <PreviewModalStage
        {...buildProps({
          entry: buildFileEntry("Projects/archive.zip", { mimeType: "application/zip" }),
          file: buildFilePreview("Projects/archive.zip", {
            viewer: "unsupported",
            name: "archive.zip",
            mimeType: "application/zip",
            unsupportedReason: "ZIP previews are not supported here."
          }),
          onDownload,
          token: "session-token"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Preview archive.zip/i });
    expect(within(dialog).getByText("This file opens outside the preview pane")).toBeInTheDocument();
    expect(within(dialog).getByText("ZIP previews are not supported here.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Download file/i }));
    expect(onDownload).toHaveBeenCalledWith("Projects/archive.zip");
  });

  it("emits close and download header actions", () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();
    render(
      <PreviewModalStage
        {...buildProps({
          file: buildFilePreview("Projects/roadmap.txt", { viewer: "text", name: "roadmap.txt" }),
          onClose,
          onDownload
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Preview roadmap.txt/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Download/i }));
    expect(onDownload).toHaveBeenCalledWith("Projects/roadmap.txt");

    fireEvent.click(within(dialog).getByRole("button", { name: /Back to files/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses via scrim click outside the dialog", () => {
    const onClose = vi.fn();
    render(
      <PreviewModalStage
        {...buildProps({
          file: buildFilePreview("Projects/roadmap.txt", { viewer: "text", name: "roadmap.txt" }),
          onClose
        })}
      />
    );

    const scrim = document.querySelector(".preview-scrim");
    if (!(scrim instanceof HTMLElement)) {
      throw new Error("Expected preview scrim element.");
    }
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("registers gallery Space advance through keydown ports", () => {
    const addWindowKeydownListener = vi.fn<(listener: (event: KeyboardEvent) => void) => () => void>(() => vi.fn());
    const onNext = vi.fn();
    render(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:image",
          file: buildFilePreview("Archive/photo.png", {
            viewer: "image",
            name: "photo.png",
            mimeType: "image/png"
          }),
          onNext,
          ports: createTestPorts({ addWindowKeydownListener })
        })}
      />
    );

    expect(addWindowKeydownListener).toHaveBeenCalledTimes(1);
    const listener = addWindowKeydownListener.mock.calls[0]?.[0];
    if (typeof listener !== "function") {
      throw new Error("Expected preview keydown listener registration.");
    }
    listener(new KeyboardEvent("keydown", { key: " ", code: "Space" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("truthfully labels original-file classification and opens through runtime ports", async () => {
    const startOriginalFileOpen = vi.fn(() => ({ completion: new Promise<void>(() => undefined), cancel: vi.fn() }));

    render(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:pdf",
          file: buildFilePreview("Docs/report.pdf", {
            viewer: "pdf",
            name: "report.pdf",
            mimeType: "application/pdf"
          }),
          token: "session-token",
          ports: createTestPorts({ startOriginalFileOpen })
        })}
      />
    );

    const originalAction = screen.getByRole("button", { name: "Open or download original file" });
    expect(originalAction).toHaveTextContent("Get original");
    fireEvent.click(originalAction);
    await waitFor(() => expect(startOriginalFileOpen).toHaveBeenCalledWith({
      path: "Docs/report.pdf",
      token: "session-token"
    }));
    expect(originalAction).toBeDisabled();
    expect(originalAction).toHaveTextContent("Opening original…");
  });

  it("cancels an original-file attempt synchronously before closing the Stage", () => {
    const order: string[] = [];
    const cancel = vi.fn(() => order.push("cancel"));
    const completion = new Promise<void>(() => undefined);
    const startOriginalFileOpen = vi.fn(() => ({ completion, cancel }));
    const onClose = vi.fn(() => order.push("close"));

    render(
      <PreviewModalStage
        {...buildProps({
          blobUrl: "blob:pdf",
          file: buildFilePreview("Docs/report.pdf", {
            viewer: "pdf",
            name: "report.pdf",
            mimeType: "application/pdf"
          }),
          token: "session-token",
          onClose,
          ports: createTestPorts({ startOriginalFileOpen })
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open or download original file" }));
    fireEvent.click(screen.getByRole("button", { name: /Back to files/i }));
    expect(order).toEqual(["cancel", "close"]);
  });

  it("preserves the modal audio element contract and inline gallery slot", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(
      <PreviewModalStage
        {...buildProps({
          accountId: "account-alpha",
          blobUrl: "blob:offline-copy",
          file: buildFilePreview("Music/track.mp3", {
            viewer: "audio",
            name: "track.mp3",
            mimeType: "audio/mpeg"
          }),
          onPrevious: vi.fn(),
          onNext: vi.fn()
        })}
      />
    );

    const audio = document.querySelector("audio.media-preview-audio");
    expect(audio).toBeInTheDocument();
    if (!(audio instanceof HTMLAudioElement)) {
      throw new Error("Expected modal audio element.");
    }
    expect(audio).toHaveAttribute("src", "blob:offline-copy");
    expect(audio).toHaveAttribute("autoplay");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveClass("media-preview", "media-preview-audio");
    expect(audio.getAttributeNames().sort()).toEqual(["autoplay", "class", "controls", "src"]);
    const mediaStage = document.querySelector(".preview-media-stage");
    expect(mediaStage).toBeInTheDocument();
    expect(mediaStage?.className).toBe("preview-media-stage");
    expect(Array.from(mediaStage?.children ?? []).map((child) => child.className)).toEqual([
      "preview-gallery-controls preview-gallery-controls-inline",
      "media-preview media-preview-audio"
    ]);

    const gallery = mediaStage?.querySelector(".preview-gallery-controls-inline");
    if (!(gallery instanceof HTMLElement)) {
      throw new Error("Expected inline gallery controls.");
    }
    const galleryButtons = within(gallery).getAllByRole("button");
    expect(galleryButtons).toHaveLength(2);
    expect(galleryButtons[0]).toHaveAttribute("aria-label", "Previous media item");
    expect(galleryButtons[0]).toHaveAttribute("title", "Previous media item");
    expect(galleryButtons[0]).toHaveAttribute("type", "button");
    expect(galleryButtons[0]?.className).toBe("preview-gallery-button preview-gallery-button-previous");
    expect(galleryButtons[1]).toHaveAttribute("aria-label", "Next media item");
    expect(galleryButtons[1]).toHaveAttribute("title", "Next media item");
    expect(galleryButtons[1]).toHaveAttribute("type", "button");
    expect(galleryButtons[1]?.className).toBe("preview-gallery-button preview-gallery-button-next");
  });

});
