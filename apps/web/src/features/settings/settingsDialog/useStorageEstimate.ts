import { useEffect, useState } from "react";

export type EstimateStorage = () => Promise<unknown>;
interface StorageEstimate { readonly usage: number; readonly quota: number }

function validEstimate(value: unknown): value is StorageEstimate {
  return typeof value === "object" && value !== null && "usage" in value && "quota" in value
    && typeof value.usage === "number" && Number.isFinite(value.usage) && value.usage >= 0
    && typeof value.quota === "number" && Number.isFinite(value.quota) && value.quota > 0;
}

export function useStorageEstimate(open: boolean, revision: string, estimate?: EstimateStorage): StorageEstimate | undefined {
  const [result, setResult] = useState<{ revision: string; estimate: EstimateStorage; value: StorageEstimate }>();
  useEffect(() => {
    if (!open || !estimate) return;
    let current = true;
    void (async () => {
      try {
        const value = await estimate();
        if (current && validEstimate(value)) setResult({ revision, estimate, value });
      } catch { /* Storage estimates are an optional browser capability. */ }
    })();
    return () => { current = false; };
  }, [open, revision, estimate]);
  return open && result?.revision === revision && result.estimate === estimate ? result.value : undefined;
}
