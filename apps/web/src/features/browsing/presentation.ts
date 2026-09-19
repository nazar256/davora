import { toDisplayPath } from "@davora/shared";

export interface BreadcrumbItem {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
}

export interface BrowseStatusInput {
  readonly count: number;
  readonly path: string;
  readonly rawSearchQuery: string;
}

export function getSearchDisplayQuery(rawQuery: string): string {
  return rawQuery.trim();
}

export function isSearchActive(rawQuery: string): boolean {
  return getSearchDisplayQuery(rawQuery).length > 0;
}

export function buildBreadcrumbs(path: string): readonly BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { label: "Home", ariaLabel: "Go to home folder", value: "" }
  ];
  let value = "";

  for (const part of path.split("/").filter(Boolean)) {
    value = value ? `${value}/${part}` : part;
    items.push({ label: part, ariaLabel: `Go to /${value}`, value });
  }

  return items;
}

export function getFolderLabel(path: string): string {
  return path ? path.split("/").pop() ?? path : "Home";
}

export function getLocationLabel(path: string): string {
  return toDisplayPath(path);
}

export function formatBrowseCount(count: number, kind: "item" | "result"): string {
  return `${count} ${count === 1 ? kind : `${kind}s`}`;
}

export function buildBrowseStatusLabel(input: BrowseStatusInput): string {
  const location = getLocationLabel(input.path);
  if (!isSearchActive(input.rawSearchQuery)) {
    return `${formatBrowseCount(input.count, "item")} in ${location}`;
  }

  return `${formatBrowseCount(input.count, "result")} for “${getSearchDisplayQuery(input.rawSearchQuery)}” in ${location}`;
}
