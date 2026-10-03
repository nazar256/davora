import { dirname, parseNormalizedPath, type SearchResult } from "@davora/shared";

import type { FolderListResult, SearchListingResult } from "./backend";

const MAX_FOLDERS = 50;
const MAX_RESULTS = 20;
const MAX_CHILDREN = 200;
const MAX_DEPTH = 3;

function scoreMatch(query: string, path: string, name: string): number {
  const lowerName = name.toLowerCase();
  if (lowerName === query) return 100;
  if (lowerName.includes(query)) return 75;
  return path.toLowerCase().includes(query) ? 50 : 0;
}

export async function boundedSearch(
  path: string,
  query: string,
  list: (path: string) => Promise<FolderListResult>
): Promise<SearchListingResult> {
  const normalizedQuery = query.trim().toLowerCase();
  const root = parseNormalizedPath(path);
  const items: SearchResult[] = [];
  if (!normalizedQuery) return { items, completeness: "complete" };

  const queue = [{ path: root, depth: 0 }];
  const scheduled = new Set<string>([root]);
  let completeness: SearchListingResult["completeness"] = "complete";
  let visited = 0;
  while (queue.length > 0 && visited < MAX_FOLDERS && items.length < MAX_RESULTS) {
    const current = queue.shift()!;
    const listing = await list(current.path);
    visited += 1;
    if (listing.completeness === "partial" || listing.items.length > MAX_CHILDREN) completeness = "partial";
    const children = listing.items.slice(0, MAX_CHILDREN);
    for (let index = 0; index < children.length; index += 1) {
      const item = children[index];
      const childPath = parseNormalizedPath(item.path);
      if (childPath === root || dirname(childPath) !== current.path) continue;
      const score = scoreMatch(normalizedQuery, childPath, item.name);
      if (score > 0) items.push({ ...item, path: childPath, score });
      if (item.isFolder && !scheduled.has(childPath)) {
        scheduled.add(childPath);
        if (current.depth < MAX_DEPTH) queue.push({ path: childPath, depth: current.depth + 1 });
        else completeness = "partial";
      }
      if (items.length === MAX_RESULTS) {
        if (index + 1 < children.length) completeness = "partial";
        break;
      }
    }
  }
  if (queue.length > 0) completeness = "partial";
  items.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return { items, completeness };
}
