export interface WorkspaceStatusSnapshot {
  readonly message: string;
}

export interface WorkspaceStatusCommands {
  readonly announce: (message: string) => void;
}

/**
 * Status is intentionally a single informational message. Every announcement
 * replaces the previous message, preserving the caller's last-writer order.
 */
export function announceWorkspaceStatus(
  snapshot: WorkspaceStatusSnapshot,
  message: string
): WorkspaceStatusSnapshot {
  if (snapshot.message === message) {
    return snapshot;
  }
  return Object.freeze({ message });
}

export function createWorkspaceStatusSnapshot(message: string): WorkspaceStatusSnapshot {
  return Object.freeze({ message });
}
