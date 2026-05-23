export interface StateBannerProps {
  kind: "loading" | "error" | "offline" | "stale" | "permission" | "idle";
  message: string;
}

export function StateBanner({ kind, message }: StateBannerProps) {
  if (kind === "idle") {
    return null;
  }

  return <p className={`banner-state ${kind}`}>{message}</p>;
}
