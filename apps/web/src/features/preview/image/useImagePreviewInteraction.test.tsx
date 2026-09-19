import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImagePreviewStage } from "./ImagePreviewStage";
import { useImagePreviewInteraction } from "./useImagePreviewInteraction";

function Harness({ blobUrl, fitMode = "fill", onFitModeChange = vi.fn(), path = "one.png" }: { blobUrl: string; fitMode?: "fill" | "fit"; onFitModeChange?: (mode: "fill" | "fit") => void; path?: string }) {
  const interaction = useImagePreviewInteraction({ source: { enabled: true, path, blobUrl }, fitMode, onFitModeChange });
  return <>
    <button onClick={interaction.controls.toggleFitMode} type="button">fit</button>
    <button onClick={interaction.controls.showOriginalSize} type="button">original</button>
    <output data-testid="failed">{String(interaction.failed)}</output>
    <output data-testid="zoom">{String(interaction.controls.hasCustomZoom)}</output>
    <ImagePreviewStage alt="photo" fitMode={fitMode} interaction={interaction.stage} onNext={vi.fn()} src={blobUrl} />
  </>;
}

describe("useImagePreviewInteraction", () => {
  afterEach(cleanup);

  it("resets failed, zoomed, and stage positioning facts for a new source tuple", () => {
    const { getByAltText, getByRole, getByTestId, rerender } = render(<Harness blobUrl="blob:one" />);
    const image = getByAltText("photo");
    const stage = getByRole("button", { name: "Open next photo after photo" });
    fireEvent.click(getByRole("button", { name: "original" }));
    fireEvent.error(image);
    stage.scrollLeft = 42;
    stage.scrollTop = 24;
    image.style.margin = "1px";
    expect(getByTestId("failed")).toHaveTextContent("true");
    expect(getByTestId("zoom")).toHaveTextContent("true");

    rerender(<Harness blobUrl="blob:two" />);
    expect(getByTestId("failed")).toHaveTextContent("false");
    expect(getByTestId("zoom")).toHaveTextContent("false");
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
    expect(image.style.margin).toBe("");
  });

  it("keeps external fit centering and exposes user Fit and 100 percent controls", () => {
    const onFitModeChange = vi.fn();
    const { getByRole, getByTestId, rerender } = render(<Harness blobUrl="blob:one" onFitModeChange={onFitModeChange} />);
    fireEvent.click(getByRole("button", { name: "fit" }));
    expect(onFitModeChange).toHaveBeenCalledWith("fit");
    fireEvent.click(getByRole("button", { name: "original" }));
    expect(getByTestId("zoom")).toHaveTextContent("true");
    rerender(<Harness blobUrl="blob:one" fitMode="fit" onFitModeChange={onFitModeChange} />);
    expect(getByTestId("zoom")).toHaveTextContent("true");
  });

  it("captures only positive natural dimensions and exposes image failure", () => {
    const { getByAltText, getByRole, getByTestId } = render(<Harness blobUrl="blob:one" />);
    const image = getByAltText("photo");
    fireEvent.click(getByRole("button", { name: "original" }));
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 0 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 100 });
    fireEvent.load(image);
    expect(image.style.width).toBe("");
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 200 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 100 });
    fireEvent.load(image);
    expect(image.style.width).toBe("200px");
    fireEvent.error(image);
    expect(getByTestId("failed")).toHaveTextContent("true");
  });

  it("clears a pending zoom anchor before a replacement source can apply it", () => {
    const { getByAltText, getByRole, rerender } = render(<Harness blobUrl="blob:one" />);
    const image = getByAltText("photo");
    const stage = getByRole("button", { name: "Open next photo after photo" });
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(stage, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 100 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 100 });
    image.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    fireEvent.wheel(stage, { clientX: 50, clientY: 50, ctrlKey: true, deltaY: -1 });
    rerender(<Harness blobUrl="blob:two" />);
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
  });
});
