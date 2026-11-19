/*
 * The state of the segment statistics view. Kept free of imports, as it is part of the store's
 * default state.
 */

// Lower and upper bound in the base unit of the statistic (not the displayed one). Null is open.
export type ValueRange = [number | null, number | null];

export type SortOrder = "ascend" | "descend";
export type StatisticsSort = { key: string; order: SortOrder } | null;

export type GroupBy = "group" | "none";
export type StatisticsMode = "table" | "compare";

// More entities than this cannot be told apart in the comparison.
export const MAX_COMPARED_COUNT = 6;

const DEFAULT_SORT: StatisticsSort = { key: "volume", order: "descend" };

export type StatisticsViewState = {
  hiddenColumnKeys: ReadonlySet<string>;
  // The label of the unit the user chose for a column, by the key of its spec.
  chosenUnits: Record<string, string>;
  ranges: Record<string, ValueRange>;
  sort: StatisticsSort;
  groupBy: GroupBy;
  mode: StatisticsMode;
  // The keys of the table rows (segments and groups) that are compared with each other.
  comparedKeys: string[];
};

export const DEFAULT_VIEW_STATE: StatisticsViewState = {
  hiddenColumnKeys: new Set(),
  chosenUnits: {},
  ranges: {},
  sort: DEFAULT_SORT,
  groupBy: "group",
  mode: "table",
  comparedKeys: [],
};
