/** Storage key layout for the diagnostics IndexedDB store (idb-keyval). */
export const DIAGNOSTICS_STORE_PREFIX = "davora-diagnostics:";
export const DIAGNOSTICS_INDEX_KEY = `${DIAGNOSTICS_STORE_PREFIX}index`;
export const diagnosticsSessionKey = (sessionId: string): string =>
  `${DIAGNOSTICS_STORE_PREFIX}session:${sessionId}`;
