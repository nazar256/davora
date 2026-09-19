/**
 * Export adapter for diagnostics bundles: browser download handoff plus
 * optional Web Share API file sharing. Everything stays local; there is no
 * upload path here.
 */

import { triggerBrowserDownload } from "../../lib/api";

interface NavigatorShareLike {
  canShare?(data: { files?: File[] }): boolean;
  share?(data: { files?: File[]; title?: string }): Promise<void>;
}

const shareApi = (): NavigatorShareLike | undefined =>
  typeof navigator === "undefined" ? undefined : navigator;

export const createBrowserDiagnosticsExport = () => ({
  saveFile(blob: Blob, filename: string): void {
    triggerBrowserDownload(blob, filename);
  },

  sharingSupported(): boolean {
    try {
      const api = shareApi();
      if (typeof api?.canShare !== "function" || typeof api.share !== "function") {
        return false;
      }
      return api.canShare({ files: [new File(["probe"], "davora-share-probe.txt", { type: "text/plain" })] });
    } catch {
      return false;
    }
  },

  async share(blob: Blob, filename: string, title: string): Promise<boolean> {
    const api = shareApi();
    if (typeof api?.share !== "function") {
      return false;
    }
    try {
      const file = new File([blob], filename, { type: "application/zip" });
      await api.share({ files: [file], title });
      return true;
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "NotAllowedError")) {
        return false;
      }
      throw error;
    }
  }
});
