export const ONLINE_CONNECTIVITY_SNAPSHOT = { kind: "online" } as const;
export const OFFLINE_CONNECTIVITY_SNAPSHOT = { kind: "offline" } as const;

export type ConnectivitySnapshot =
  | typeof ONLINE_CONNECTIVITY_SNAPSHOT
  | typeof OFFLINE_CONNECTIVITY_SNAPSHOT;

export type ConnectivityListener = (snapshot: ConnectivitySnapshot) => void;

export interface ConnectivityPort {
  readonly read: () => ConnectivitySnapshot;
  readonly subscribe: (listener: ConnectivityListener) => () => void;
}
