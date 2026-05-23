export type FileSizeDisplayMode = "human" | "kb" | "mb" | "gb";

export const FILE_SIZE_DISPLAY_OPTIONS: Array<{ value: FileSizeDisplayMode; label: string }> = [
  { value: "human", label: "Human readable" },
  { value: "kb", label: "KB" },
  { value: "mb", label: "MB" },
  { value: "gb", label: "GB" }
];

export function getFileSizeDisplayModeLabel(mode: FileSizeDisplayMode): string {
  return FILE_SIZE_DISPLAY_OPTIONS.find((option) => option.value === mode)?.label ?? "Human readable";
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

const FIXED_FILE_SIZE_UNITS: Record<Exclude<FileSizeDisplayMode, "human">, { divisor: number; unit: string }> = {
  kb: { divisor: 1024, unit: "KB" },
  mb: { divisor: 1024 ** 2, unit: "MB" },
  gb: { divisor: 1024 ** 3, unit: "GB" }
};

export function isFileSizeDisplayMode(value: string): value is FileSizeDisplayMode {
  return FILE_SIZE_DISPLAY_OPTIONS.some((option) => option.value === value);
}

function formatFixedFileSize(value: number, mode: Exclude<FileSizeDisplayMode, "human">): string {
  const { divisor, unit } = FIXED_FILE_SIZE_UNITS[mode];
  const converted = value / divisor;
  const maximumFractionDigits = converted >= 100 ? 0 : converted >= 10 ? 1 : 2;
  const minimumFractionDigits = converted > 0 && converted < 1 ? Math.min(2, maximumFractionDigits) : 0;

  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits }).format(converted)} ${unit}`;
}

export function formatFileSize(value: number | undefined, mode: FileSizeDisplayMode = "human"): string {
  if (value === undefined) {
    return "—";
  }

  if (mode !== "human") {
    return formatFixedFileSize(value, mode);
  }

  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(size)} ${FILE_SIZE_UNITS[unitIndex]}`;
}
