/** Clock and identifier adapters for diagnostics. */

export const createBrowserDiagnosticsClock = () => ({
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString()
});

export const createBrowserDiagnosticsIds = () => ({
  next: () => crypto.randomUUID()
});
