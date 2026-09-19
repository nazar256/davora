export interface ReloadPromptStageProps {
  needRefresh: boolean;
  onDismiss(): void;
  onReload(): Promise<void>;
  reloading: boolean;
}

export function ReloadPromptStage({ needRefresh, onDismiss, onReload, reloading }: ReloadPromptStageProps) {
  if (!needRefresh) {
    return null;
  }

  return (
    <div className="toast" role="status" aria-live="polite">
      <div>Updated app shell ready. Reload to apply it now.</div>
      <div className="toast-actions">
        <button disabled={reloading} onClick={() => void onReload()} type="button">{reloading ? "Reloading…" : "Reload"}</button>
        <button disabled={reloading} onClick={onDismiss} type="button">Dismiss</button>
      </div>
    </div>
  );
}
