import { describe, expect, it } from "vitest";

import { buildCapabilitySet, getViewerKind } from "../src/index";

describe("shared capability and viewer helpers", () => {
  it("maps backend capabilities with mutation support", () => {
    const capabilities = buildCapabilitySet("nextcloud");
    expect(capabilities).toMatchObject({
      backend: "nextcloud",
      readOnly: false,
      createFolder: true,
      upload: true,
      move: true,
      copy: true,
      delete: true,
      openedFileCache: true
    });
  });

  it("derives viewer kinds from mime types", () => {
    expect(getViewerKind("text/plain")).toBe("text");
    expect(getViewerKind("text/markdown")).toBe("markdown");
    expect(getViewerKind("text/markdown;charset=UTF-8")).toBe("markdown");
    expect(getViewerKind("application/pdf")).toBe("pdf");
    expect(getViewerKind("image/png")).toBe("image");
    expect(getViewerKind("audio/mpeg")).toBe("audio");
    expect(getViewerKind("video/mp4")).toBe("video");
    expect(getViewerKind("application/octet-stream")).toBe("unsupported");
  });
});
