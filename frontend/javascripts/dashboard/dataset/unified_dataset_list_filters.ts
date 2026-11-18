// Unified datasets prototype (features.unifiedDatasets): the filters of the dataset list.
import features from "features";
import UserLocalStorage from "libs/user_local_storage";
import { useCallback, useState } from "react";
import type { APIDatasetCompact } from "types/api_types";

export type AnnotationLayerFilter = "all" | "withoutAnnotationLayers" | "withAnnotationLayers";
// Mirrors the backend's `copies` parameter of GET /api/datasets.
export type DatasetCopiesParam = "mineAndShared" | "all" | "none";

export type UnifiedDatasetListFilters = {
  annotationLayerFilter: AnnotationLayerFilter;
  // Render copies as child rows of their source.
  groupCopies: boolean;
  // Also list the copies of other users (not only the own and shared ones).
  showCopiesByOthers: boolean;
};

const DEFAULT_FILTERS: UnifiedDatasetListFilters = {
  annotationLayerFilter: "all",
  groupCopies: true,
  showCopiesByOthers: false,
};
const STORAGE_KEY = "unifiedDatasetListFilters";
const ANNOTATION_LAYER_FILTERS: AnnotationLayerFilter[] = [
  "all",
  "withoutAnnotationLayers",
  "withAnnotationLayers",
];

export function isUnifiedDatasetsMode(): boolean {
  // Same check as the viewer (the dev config may deliver the flag as a string).
  return Boolean(features().unifiedDatasets);
}

function loadFilters(): UnifiedDatasetListFilters {
  try {
    const stored = JSON.parse(UserLocalStorage.getItem(STORAGE_KEY) || "{}");
    return {
      annotationLayerFilter: ANNOTATION_LAYER_FILTERS.includes(stored.annotationLayerFilter)
        ? stored.annotationLayerFilter
        : DEFAULT_FILTERS.annotationLayerFilter,
      groupCopies:
        typeof stored.groupCopies === "boolean" ? stored.groupCopies : DEFAULT_FILTERS.groupCopies,
      showCopiesByOthers:
        typeof stored.showCopiesByOthers === "boolean"
          ? stored.showCopiesByOthers
          : DEFAULT_FILTERS.showCopiesByOthers,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// The filters are remembered per user in the local storage.
export function useUnifiedDatasetListFilters() {
  const [filters, setFiltersState] = useState<UnifiedDatasetListFilters>(loadFilters);
  const updateFilters = useCallback((update: Partial<UnifiedDatasetListFilters>) => {
    setFiltersState((previous) => {
      const next = { ...previous, ...update };
      UserLocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [filters, updateFilters] as const;
}

export function getCopiesParam(filters: UnifiedDatasetListFilters): DatasetCopiesParam {
  return filters.showCopiesByOthers ? "all" : "mineAndShared";
}

export function filterByAnnotationLayers<T extends Pick<APIDatasetCompact, "annotationLayers">>(
  datasets: T[],
  filter: AnnotationLayerFilter,
): T[] {
  if (filter === "all") return datasets;
  const wantsAnnotationLayers = filter === "withAnnotationLayers";
  return datasets.filter(
    (dataset) => (dataset.annotationLayers?.length ?? 0) > 0 === wantsAnnotationLayers,
  );
}

type CopyLike = { id: string; copiedFromId?: string | null };

// Groups copies below their source. A copy's parent is its source if that is one of the given
// rows (which may itself be a copy, giving nested groups). Copies whose source isn't among the
// rows stay at the top level. The order of the rows is kept, also among siblings.
export function groupCopiesBySource<Row>(
  rows: Row[],
  getDataset: (row: Row) => CopyLike | null,
): { topLevelRows: Row[]; childrenByRow: Map<Row, Row[]> } {
  const rowById = new Map<string, Row>();
  for (const row of rows) {
    const dataset = getDataset(row);
    if (dataset != null) rowById.set(dataset.id, row);
  }
  const getParent = (row: Row): Row | null => {
    const sourceId = getDataset(row)?.copiedFromId;
    return sourceId != null ? (rowById.get(sourceId) ?? null) : null;
  };
  // Guards against cyclic copiedFromId chains, which shouldn't exist.
  const isInCycle = (row: Row) => {
    const visited = new Set<Row>([row]);
    let current = getParent(row);
    while (current != null) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = getParent(current);
    }
    return false;
  };

  const topLevelRows: Row[] = [];
  const childrenByRow = new Map<Row, Row[]>();
  for (const row of rows) {
    const parent = getParent(row);
    if (parent == null || isInCycle(row)) {
      topLevelRows.push(row);
      continue;
    }
    const siblings = childrenByRow.get(parent);
    if (siblings != null) siblings.push(row);
    else childrenByRow.set(parent, [row]);
  }
  return { topLevelRows, childrenByRow };
}

// The number of (direct) copies of each dataset among the given datasets.
export function countCopiesBySourceId(datasets: CopyLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const dataset of datasets) {
    if (dataset.copiedFromId != null) {
      counts.set(dataset.copiedFromId, (counts.get(dataset.copiedFromId) ?? 0) + 1);
    }
  }
  return counts;
}

export function getCopiesOfDatasetIdFromUrl(): string | null {
  if (!isUnifiedDatasetsMode()) return null;
  return new URLSearchParams(location.search).get("copiesOf") || null;
}
