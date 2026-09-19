/** Local structural copy keeps platform adapters independent of feature modules. */
export interface BrowserClipboardPort {
  /** Returns whether the text reached the clipboard; never throws. */
  writeText(text: string): Promise<boolean>;
}

interface BrowserClipboardNavigator {
  readonly clipboard?: {
    writeText(text: string): Promise<void>;
  };
}

export const createBrowserClipboardPort = (
  resolveNavigator: () => BrowserClipboardNavigator = () => window.navigator
): BrowserClipboardPort => ({
  async writeText(text) {
    const clipboard = resolveNavigator().clipboard;
    if (!clipboard) {
      return false;
    }

    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
});
