import { useEffect, useMemo, useState } from "react";

import { formatFileSize, getFileSizeDisplayModeLabel, type FileSizeDisplayMode } from "../../../lib/fileSize";
import {
  clampMaxCacheableFileSizeBytes,
  MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  MIN_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  clampPreviewFreshnessIntervalSeconds,
  normalizeImagePreviewPrefetchCount
} from "../model";
import type { ImagePreviewPrefetchCount } from "../model";

const PREVIEW_FRESHNESS_UNITS = [
  { value: "seconds", label: "second(s)", multiplier: 1 },
  { value: "minutes", label: "minute(s)", multiplier: 60 },
  { value: "hours", label: "hour(s)", multiplier: 60 * 60 },
  { value: "days", label: "day(s)", multiplier: 24 * 60 * 60 },
  { value: "weeks", label: "week(s)", multiplier: 7 * 24 * 60 * 60 },
  { value: "months", label: "month(s)", multiplier: 30 * 24 * 60 * 60 }
] as const;
const MIN_OPENED_FILE_CACHE_LIMIT = 1024 * 1024;
const MAX_OPENED_FILE_CACHE_LIMIT = 8 * 1024 * 1024 * 1024;

type PreviewFreshnessUnit = typeof PREVIEW_FRESHNESS_UNITS[number]["value"];

function clampCacheLimit(limitBytes: number): number {
  if (!Number.isFinite(limitBytes)) {
    return MIN_OPENED_FILE_CACHE_LIMIT;
  }

  return Math.min(MAX_OPENED_FILE_CACHE_LIMIT, Math.max(MIN_OPENED_FILE_CACHE_LIMIT, Math.round(limitBytes)));
}

function bytesToMegabytes(limitBytes: number): number {
  return Math.round(clampCacheLimit(limitBytes) / (1024 * 1024));
}

function megabytesToBytes(limitMegabytes: number): number {
  return clampCacheLimit(limitMegabytes * 1024 * 1024);
}

function formatSliderLabel(limitBytes: number, mode: FileSizeDisplayMode): string {
  const megabytes = bytesToMegabytes(limitBytes);
  if (megabytes < 1024) {
    return `${megabytes} MB`;
  }

  return formatFileSize(limitBytes, mode);
}

function bytesToMegabytesRounded(limitBytes: number): number {
  return Math.round(limitBytes / (1024 * 1024));
}

function choosePreviewFreshnessUnit(seconds: number): PreviewFreshnessUnit {
  for (const unit of [...PREVIEW_FRESHNESS_UNITS].reverse()) {
    if (seconds >= unit.multiplier && seconds % unit.multiplier === 0) {
      return unit.value;
    }
  }

  return "seconds";
}

function getPreviewFreshnessMultiplier(unit: PreviewFreshnessUnit): number {
  return PREVIEW_FRESHNESS_UNITS.find((option) => option.value === unit)?.multiplier ?? 60;
}

export interface CachePanelProps {
  itemCount: number;
  totalBytes: number;
  limitBytes: number;
  fileSizeDisplayMode: FileSizeDisplayMode;
  maxCacheableFileSizeBytes: number;
  previewFreshnessIntervalSeconds: number;
  imagePreviewPrefetchCount: ImagePreviewPrefetchCount;
  offlineItems: Array<{
    rootId: string;
    rootPath: string;
    name: string;
    kind: "file" | "folder" | "batch";
    fileCount: number;
    totalBytes: number;
    addedAt?: string;
  }>;
  onClear: () => void;
  onRemoveOfflineItem: (rootId: string) => void;
  onLimitChange: (limitBytes: number) => void;
  onMaxCacheableFileSizeChange: (limitBytes: number) => void;
  onPreviewFreshnessIntervalChange: (intervalSeconds: number) => void;
  onImagePreviewPrefetchCountChange: (count: ImagePreviewPrefetchCount) => void;
}

export function CachePanel(props: CachePanelProps) {
  const itemLabel = props.itemCount === 1 ? "cached file" : "cached files";
  const [manualLimitMb, setManualLimitMb] = useState(() => String(bytesToMegabytes(props.limitBytes)));
  const [manualMaxCacheableMb, setManualMaxCacheableMb] = useState(() => String(bytesToMegabytesRounded(props.maxCacheableFileSizeBytes)));
  const [previewFreshnessUnit, setPreviewFreshnessUnit] = useState<PreviewFreshnessUnit>(() => choosePreviewFreshnessUnit(props.previewFreshnessIntervalSeconds));
  const [previewFreshnessValue, setPreviewFreshnessValue] = useState(() => String(Math.max(1, Math.round(props.previewFreshnessIntervalSeconds / getPreviewFreshnessMultiplier(choosePreviewFreshnessUnit(props.previewFreshnessIntervalSeconds))))));

  useEffect(() => {
    setManualLimitMb(String(bytesToMegabytes(props.limitBytes)));
  }, [props.limitBytes]);

  useEffect(() => {
    setManualMaxCacheableMb(String(bytesToMegabytesRounded(props.maxCacheableFileSizeBytes)));
  }, [props.maxCacheableFileSizeBytes]);

  useEffect(() => {
    const nextUnit = choosePreviewFreshnessUnit(props.previewFreshnessIntervalSeconds);
    setPreviewFreshnessUnit(nextUnit);
    setPreviewFreshnessValue(String(Math.max(1, Math.round(props.previewFreshnessIntervalSeconds / getPreviewFreshnessMultiplier(nextUnit)))));
  }, [props.previewFreshnessIntervalSeconds]);

  const sliderValue = useMemo(() => String(bytesToMegabytes(props.limitBytes)), [props.limitBytes]);

  const applyManualLimit = () => {
    const parsed = Number.parseFloat(manualLimitMb);
    if (!Number.isFinite(parsed)) {
      setManualLimitMb(String(bytesToMegabytes(props.limitBytes)));
      return;
    }

    const clampedMegabytes = Math.min(8192, Math.max(1, Math.round(parsed)));
    const nextLimitBytes = megabytesToBytes(clampedMegabytes);
    setManualLimitMb(String(clampedMegabytes));
    if (nextLimitBytes !== props.limitBytes) {
      props.onLimitChange(nextLimitBytes);
    }
  };

  const applyManualMaxCacheable = () => {
    const parsed = Number.parseFloat(manualMaxCacheableMb);
    if (!Number.isFinite(parsed)) {
      setManualMaxCacheableMb(String(bytesToMegabytesRounded(props.maxCacheableFileSizeBytes)));
      return;
    }

    const clampedMegabytes = Math.min(
      bytesToMegabytesRounded(MAX_MAX_CACHEABLE_FILE_SIZE_BYTES),
      Math.max(bytesToMegabytesRounded(MIN_MAX_CACHEABLE_FILE_SIZE_BYTES), Math.round(parsed))
    );
    const nextLimitBytes = clampMaxCacheableFileSizeBytes(clampedMegabytes * 1024 * 1024);
    setManualMaxCacheableMb(String(clampedMegabytes));
    if (nextLimitBytes !== props.maxCacheableFileSizeBytes) {
      props.onMaxCacheableFileSizeChange(nextLimitBytes);
    }
  };

  const applyPreviewFreshnessInterval = (nextValue = previewFreshnessValue, nextUnit = previewFreshnessUnit) => {
    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) {
      const currentUnit = choosePreviewFreshnessUnit(props.previewFreshnessIntervalSeconds);
      setPreviewFreshnessUnit(currentUnit);
      setPreviewFreshnessValue(String(Math.max(1, Math.round(props.previewFreshnessIntervalSeconds / getPreviewFreshnessMultiplier(currentUnit)))));
      return;
    }

    const clampedSeconds = clampPreviewFreshnessIntervalSeconds(Math.round(parsed) * getPreviewFreshnessMultiplier(nextUnit));
    props.onPreviewFreshnessIntervalChange(clampedSeconds);
  };

  return (
    <section className="cache-panel settings-section">
      <div className="panel-header">
        <div>
          <p className="eyebrow section-eyebrow">Storage</p>
          <h3>Offline cache</h3>
        </div>
        <button onClick={props.onClear} type="button">Clear cache</button>
      </div>
      <p className="cache-summary">
        <strong>{props.itemCount}</strong> {itemLabel} • {formatFileSize(props.totalBytes, props.fileSizeDisplayMode)} used
      </p>
      <p className="status">Opened files stay available until the cache is cleared or older entries are evicted.</p>
      <div className="offline-files-management">
        <div className="panel-header compact-panel-header">
          <div>
            <p className="eyebrow section-eyebrow">Offline files</p>
            <h4>Kept on this device</h4>
          </div>
        </div>
        {props.offlineItems.length === 0 ? <p className="status">No files or folders are explicitly kept offline yet.</p> : null}
        {props.offlineItems.length > 0 ? (
          <ul className="offline-files-list">
            {props.offlineItems.map((item) => (
              <li key={item.rootId} className="offline-files-item">
                <div>
                  <strong>{item.name}</strong>
                  <p className="status">{item.kind === "folder" ? "Recursive folder" : item.kind === "batch" ? "Batch selection" : "File"} • {item.fileCount} {item.fileCount === 1 ? "file" : "files"} • {formatFileSize(item.totalBytes, props.fileSizeDisplayMode)}</p>
                  <p className="status">{item.rootPath}</p>
                </div>
                <button aria-label={`Remove offline copy for ${item.name} from this device`} className="quiet-button" onClick={() => props.onRemoveOfflineItem(item.rootId)} type="button">Remove from this device</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="status">Current mode for cache-related sizes: {getFileSizeDisplayModeLabel(props.fileSizeDisplayMode)}.</p>
      <label className="stacked-field cache-limit-field">
        <span className="summary-label">Opened-file cache limit</span>
        <div className="cache-limit-controls">
          <div className="stacked-field cache-limit-slider-field">
            <div className="cache-limit-slider-summary">
              <span className="summary-label">Slider</span>
              <span className="status">{formatSliderLabel(props.limitBytes, props.fileSizeDisplayMode)}</span>
            </div>
            <input
              aria-label="Opened-file cache limit slider"
              max="8192"
              min="1"
              onChange={(event) => props.onLimitChange(megabytesToBytes(Number(event.target.value)))}
              type="range"
              value={sliderValue}
            />
            <div className="cache-limit-scale status">
              <span>1 MB</span>
              <span>8 GB</span>
            </div>
          </div>
          <div className="stacked-field cache-limit-manual-field">
            <span className="summary-label">Manual value</span>
            <div className="cache-limit-manual-row">
              <input
                aria-label="Opened-file cache limit in MB"
                inputMode="numeric"
                min="1"
                onBlur={applyManualLimit}
                onChange={(event) => setManualLimitMb(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyManualLimit();
                  }
                }}
                type="number"
                value={manualLimitMb}
              />
              <span className="status">MB</span>
            </div>
          </div>
        </div>
      </label>
      <label className="stacked-field cache-limit-field">
        <span className="summary-label">Max file size to store in browser cache</span>
        <div className="cache-limit-controls">
          <div className="stacked-field cache-limit-slider-field">
            <div className="cache-limit-slider-summary">
              <span className="summary-label">Slider</span>
              <span className="status">{formatSliderLabel(props.maxCacheableFileSizeBytes, props.fileSizeDisplayMode)}</span>
            </div>
            <input
              aria-label="Max file size eligible for browser cache slider"
              max={String(bytesToMegabytesRounded(MAX_MAX_CACHEABLE_FILE_SIZE_BYTES))}
              min={String(bytesToMegabytesRounded(MIN_MAX_CACHEABLE_FILE_SIZE_BYTES))}
              onChange={(event) => props.onMaxCacheableFileSizeChange(clampMaxCacheableFileSizeBytes(Number(event.target.value) * 1024 * 1024))}
              type="range"
              value={String(bytesToMegabytesRounded(props.maxCacheableFileSizeBytes))}
            />
            <div className="cache-limit-scale status">
              <span>1 MB</span>
              <span>1 GB</span>
            </div>
          </div>
          <div className="stacked-field cache-limit-manual-field">
            <span className="summary-label">Manual value</span>
            <div className="cache-limit-manual-row">
              <input
                aria-label="Max file size eligible for browser cache in MB"
                inputMode="numeric"
                min="1"
                onBlur={applyManualMaxCacheable}
                onChange={(event) => setManualMaxCacheableMb(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyManualMaxCacheable();
                  }
                }}
                type="number"
                value={manualMaxCacheableMb}
              />
              <span className="status">MB</span>
            </div>
          </div>
        </div>
      </label>
      <label className="stacked-field cache-limit-field">
        <span className="summary-label">Images to preload ahead</span>
        <select
          aria-label="Images to preload ahead"
          onChange={(event) => props.onImagePreviewPrefetchCountChange(normalizeImagePreviewPrefetchCount(Number(event.target.value)))}
          value={String(props.imagePreviewPrefetchCount)}
        >
          <option value="1">1 image</option>
          <option value="2">2 images</option>
          <option value="3">3 images</option>
        </select>
        <span className="status">Cached and kept-offline HEIC images are decoded to JPEG in the background before gallery navigation.</span>
      </label>
      <label className="stacked-field cache-limit-field">
        <span className="summary-label">Check cached previews for updates after</span>
        <div className="cache-limit-manual-row">
          <input
            aria-label="Cached preview update check interval value"
            inputMode="numeric"
            min="1"
            onBlur={() => applyPreviewFreshnessInterval()}
            onChange={(event) => setPreviewFreshnessValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyPreviewFreshnessInterval();
              }
            }}
            type="number"
            value={previewFreshnessValue}
          />
          <select
            aria-label="Cached preview update check interval unit"
            onChange={(event) => {
              const nextUnit = event.target.value as PreviewFreshnessUnit;
              setPreviewFreshnessUnit(nextUnit);
              applyPreviewFreshnessInterval(previewFreshnessValue, nextUnit);
            }}
            value={previewFreshnessUnit}
          >
            {PREVIEW_FRESHNESS_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
        </div>
        <span className="status">Range: {MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS} second to {Math.round(MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS / (24 * 60 * 60))} days.</span>
      </label>
      <details className="cache-details">
        <summary>View cache details</summary>
        <dl className="metadata cache-metadata">
          <div>
            <dt>Entries</dt>
            <dd>{props.itemCount}</dd>
          </div>
          <div>
            <dt>Stored data</dt>
            <dd>{formatFileSize(props.totalBytes, props.fileSizeDisplayMode)}</dd>
          </div>
          <div>
            <dt>Cache limit</dt>
            <dd>{formatFileSize(props.limitBytes, props.fileSizeDisplayMode)}</dd>
          </div>
          <div>
            <dt>Max cached file size</dt>
            <dd>{formatFileSize(props.maxCacheableFileSizeBytes, props.fileSizeDisplayMode)}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
