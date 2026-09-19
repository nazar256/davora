export interface SystemClock {
  nowIso(): string;
}

export const createSystemClock = (
  now: () => Date = () => new Date()
): SystemClock => ({
  nowIso: () => now().toISOString()
});
