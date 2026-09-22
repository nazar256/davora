import type { BreadcrumbItem } from "../presentation";

export type FileListBreadcrumbNode =
  | { readonly kind: "item"; readonly item: BreadcrumbItem }
  | { readonly kind: "ellipsis" };

const MAX_UNFOLDED_BREADCRUMBS = 4;
const TRAILING_BREADCRUMBS = 2;

export function foldFileListBreadcrumbs(items: readonly BreadcrumbItem[]): readonly FileListBreadcrumbNode[] {
  if (items.length <= MAX_UNFOLDED_BREADCRUMBS) {
    return items.map((item): FileListBreadcrumbNode => ({ kind: "item", item }));
  }
  return [
    ...items.slice(0, 1).map((item): FileListBreadcrumbNode => ({ kind: "item", item })),
    { kind: "ellipsis" },
    ...items.slice(-TRAILING_BREADCRUMBS).map((item): FileListBreadcrumbNode => ({ kind: "item", item }))
  ];
}
