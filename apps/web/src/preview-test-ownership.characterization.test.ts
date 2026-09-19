import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../tests");
const appSource = resolve(testsRoot, "app.spec.ts");
const previewSource = resolve(testsRoot, "preview.spec.ts");

const previewTitles = [
  "preview supports markdown MIME variants, inline PDF rendering, and PDF open fallback",
  "closing a preview cancels its pending original-file popup without disturbing the replacement preview",
  "mobile preview toolbar keeps long image actions separated and tappable",
  "gallery overlay adds next/previous controls and photo-only quick advance behavior",
  "image preview navigation uses viewport-fixed edge zones",
  "folder audio player reopens at the last remembered position for the same browser account",
  "folder audio player uses current folder tracks and restores per-folder progress",
  "immersive video and settings close through explicit controls",
  "PER-72 keeps immersive media controls compact and folder audio in place",
  "PER-65 video navigation stays video-only with clear toolbar boundaries",
  "media preview attempts autoplay for audio and video and pauses when switching",
  "large video preview streams through the Worker without full-file download",
  "broken image preview falls back gracefully instead of showing a broken browser image"
] as const;

const previewOnlyResidue = [
  "rendered-markdown",
  "preview-media-stage-image",
  "preview-header-actions-immersive",
  "__davoraMediaEvents",
  "/api/file/stream?",
  "originalFileGate",
  "captureImageAnchor",
  "getImageAnchorDelta"
] as const;

function titleCount(source: string, title: string): number {
  const escaped = title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return source.match(new RegExp(`test\\(\\\"${escaped}\\\"`, "g"))?.length ?? 0;
}

describe("preview Playwright ownership", () => {
  it("keeps the selected preview/media titles exactly once in preview.spec.ts and absent from app.spec.ts", () => {
    const app = readFileSync(appSource, "utf8");
    const preview = readFileSync(previewSource, "utf8");
    for (const title of previewTitles) {
      expect(titleCount(preview, title), `preview title count: ${title}`).toBe(1);
      expect(titleCount(app, title), `app title residue: ${title}`).toBe(0);
    }
  });

  it("does not leave preview-only selectors or helper policy in app.spec.ts", () => {
    const app = readFileSync(appSource, "utf8");
    for (const marker of previewOnlyResidue) {
      expect(app, `preview-only residue: ${marker}`).not.toContain(marker);
    }
  });
});
