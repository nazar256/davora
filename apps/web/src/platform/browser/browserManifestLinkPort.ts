/**
 * Owns the document `<link rel="manifest">` element so a feature can
 * temporarily point installability at a folder-specific manifest.
 *
 * Local structural copies keep platform adapters independent of feature modules.
 */
export interface BrowserManifestLinkPort {
  /**
   * Point the document manifest at the serialized manifest JSON.
   * Returns an idempotent restore callback that reinstates the previous
   * manifest link (or removes the element if it created one) and revokes
   * the object URL.
   */
  attachManifest(serializedManifest: string): () => void;
}

interface BrowserManifestDocument {
  head: {
    querySelector(selectors: string): Element | null;
    appendChild<T extends Node>(node: T): T;
  };
  createElement(tagName: string): HTMLElement;
}

interface BrowserManifestUrl {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const MANIFEST_LINK_SELECTOR = 'link[rel="manifest"]';

export const createBrowserManifestLinkPort = (
  resolveDocument: () => BrowserManifestDocument = () => window.document,
  resolveUrl: () => BrowserManifestUrl = () => window.URL
): BrowserManifestLinkPort => ({
  attachManifest(serializedManifest) {
    const doc = resolveDocument();
    const urlApi = resolveUrl();
    const blobUrl = urlApi.createObjectURL(new Blob([serializedManifest], { type: "application/manifest+json" }));
    const existing = doc.head.querySelector(MANIFEST_LINK_SELECTOR);
    let restored = false;

    if (existing) {
      const previousHref = existing.getAttribute("href");
      existing.setAttribute("href", blobUrl);
      return () => {
        if (restored) {
          return;
        }
        restored = true;
        if (previousHref === null) {
          existing.removeAttribute("href");
        } else {
          existing.setAttribute("href", previousHref);
        }
        urlApi.revokeObjectURL(blobUrl);
      };
    }

    const link = doc.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", blobUrl);
    doc.head.appendChild(link);
    return () => {
      if (restored) {
        return;
      }
      restored = true;
      link.remove();
      urlApi.revokeObjectURL(blobUrl);
    };
  }
});
