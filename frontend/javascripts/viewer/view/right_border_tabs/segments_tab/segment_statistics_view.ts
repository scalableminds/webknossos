import { getBestUnitForValue, UnitsMap } from "libs/format_utils";
import max from "lodash-es/max";
import min from "lodash-es/min";
import { useCallback, useMemo, useReducer } from "react";
import { UnitShort } from "viewer/constants";
import type {
  SegmentStatisticsRow,
  StatisticCategory,
  StatisticSpec,
  StatisticValue,
} from "./segment_statistics_helpers";

/*
 * The state of the segment statistics view (which columns are shown, in which unit, how the rows
 * are filtered, sorted and grouped) together with the pure functions that apply it.
 */

// A statistic that is shown as a column and listed in the rail.
export type ColumnSpec = StatisticSpec & {
  title: string;
  category: StatisticCategory;
  value: StatisticValue;
};

export type ResolvedUnit = { label: string; factor: number };

// Lower and upper bound in the base unit of the statistic (not the displayed one). Null is open.
export type ValueRange = [number | null, number | null];

export type SortOrder = "ascend" | "descend";
export type StatisticsSort = { key: string; order: SortOrder } | null;

export type GroupBy = "group" | "none";

export const SEGMENT_COLUMN_KEY = "segment";
const DEFAULT_SORT: StatisticsSort = { key: "volume", order: "descend" };
const DEFAULT_FRACTION_DIGITS = 2;

// The units that can be chosen for a column, besides the automatically chosen one.
const SELECTABLE_UNITS = [UnitShort.nm, UnitShort.µm, UnitShort.mm];

export function getColumnSpecs(statisticSpecs: StatisticSpec[]): ColumnSpec[] {
  return statisticSpecs.flatMap((spec) => {
    const { title, category, value } = spec;
    return title != null && category != null && value != null
      ? [{ ...spec, title, category, value }]
      : [];
  });
}

function getUnitLabel(unit: UnitShort, dimension: 1 | 2 | 3): string {
  return dimension === 1 ? unit : dimension === 2 ? `${unit}²` : `${unit}³`;
}

// Returns the units a statistic can be shown in. Empty for statistics with a fixed unit.
export function getSelectableUnits(value: StatisticValue, datasetUnit: UnitShort): ResolvedUnit[] {
  const { unit } = value;
  if (typeof unit === "string") {
    return [];
  }
  return SELECTABLE_UNITS.map((selectableUnit) => ({
    label: getUnitLabel(selectableUnit, unit.dimension),
    factor: (UnitsMap[selectableUnit] / UnitsMap[datasetUnit]) ** unit.dimension,
  }));
}

/*
 * All values of a column share one unit, so that they can be compared at a glance. Unless the
 * user chose a unit, a physical unit is picked so that it fits the median value of the column.
 */
export function resolveUnit(
  value: StatisticValue,
  rows: SegmentStatisticsRow[],
  datasetUnit: UnitShort,
  chosenUnitLabel?: string,
): ResolvedUnit {
  if (typeof value.unit === "string") {
    return { label: value.unit, factor: 1 };
  }
  const chosenUnit = getSelectableUnits(value, datasetUnit).find(
    (unit) => unit.label === chosenUnitLabel,
  );
  if (chosenUnit != null) {
    return chosenUnit;
  }
  const numbers = rows
    .flatMap((row) => {
      const rowValue = value.get(row);
      if (rowValue == null) return [];
      return typeof rowValue === "number" ? [rowValue] : [rowValue[0]];
    })
    .sort((a, b) => a - b);
  const median = numbers[Math.floor(numbers.length / 2)] ?? 0;
  const { factor, unit } = getBestUnitForValue(median, datasetUnit, value.unit.dimension);
  return { label: unit, factor };
}

export function formatStatisticNumber(
  number: number,
  value: StatisticValue,
  unit: ResolvedUnit,
): string {
  const fractionDigits = value.fractionDigits ?? DEFAULT_FRACTION_DIGITS;
  const numberInUnit = number / unit.factor;
  if (numberInUnit !== 0 && Math.abs(numberInUnit) < 10 ** -fractionDigits) {
    // Too small for the fixed decimal places (e.g. because a large unit was chosen). Show the
    // leading digits instead of a misleading zero.
    return numberInUnit.toLocaleString("en-US", { maximumSignificantDigits: 2 });
  }
  return numberInUnit.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function isRangeInverted(range: ValueRange | undefined): boolean {
  return range != null && range[0] != null && range[1] != null && range[0] > range[1];
}

// Keeps the rows whose values lie within all active ranges. Rows without a value for a filtered
// statistic are dropped, since they cannot be known to match. Filters for loading or errored
// statistics are skipped so rows stay visible with spinners or "n/a".
export function filterRows(
  rows: SegmentStatisticsRow[],
  columnSpecs: ColumnSpec[],
  ranges: Record<string, ValueRange>,
): SegmentStatisticsRow[] {
  const activeFilters = columnSpecs.flatMap((spec) => {
    const range = ranges[spec.key];
    return range != null && spec.value.kind === "number" && !spec.isLoading && !spec.isError
      ? [{ value: spec.value, range }]
      : [];
  });
  if (activeFilters.length === 0) {
    return rows;
  }
  return rows.filter((row) =>
    activeFilters.every(({ value, range: [minBound, maxBound] }) => {
      const number = value.get(row);
      return (
        number != null &&
        (minBound == null || number >= minBound) &&
        (maxBound == null || number <= maxBound)
      );
    }),
  );
}

export type Histogram = { bins: number[]; min: number; max: number };

export function computeHistogram(numbers: number[], binCount: number): Histogram | null {
  if (numbers.length === 0) {
    return null;
  }
  // Spreading a large array into Math.min/max would exceed the maximum number of arguments.
  const minValue = min(numbers) ?? 0;
  const maxValue = max(numbers) ?? 0;
  const bins = new Array<number>(binCount).fill(0);
  for (const number of numbers) {
    const relativePosition = maxValue > minValue ? (number - minValue) / (maxValue - minValue) : 0;
    bins[Math.min(binCount - 1, Math.floor(relativePosition * binCount))]++;
  }
  return { bins, min: minValue, max: maxValue };
}

export type StatisticsViewState = {
  hiddenColumnKeys: ReadonlySet<string>;
  // The label of the unit the user chose for a column, by the key of its spec.
  chosenUnits: Record<string, string>;
  ranges: Record<string, ValueRange>;
  sort: StatisticsSort;
  groupBy: GroupBy;
};

export const DEFAULT_VIEW_STATE: StatisticsViewState = {
  hiddenColumnKeys: new Set(),
  chosenUnits: {},
  ranges: {},
  sort: DEFAULT_SORT,
  groupBy: "group",
};

export type StatisticsView = StatisticsViewState & {
  toggleColumn: (key: string) => void;
  setChosenUnit: (key: string, unitLabel: string | null) => void;
  setRange: (key: string, range: ValueRange) => void;
  resetRanges: () => void;
  setSort: (sort: StatisticsSort) => void;
  setGroupBy: (groupBy: GroupBy) => void;
};

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

export type StatisticsViewAction =
  | { type: "toggleColumn"; key: string }
  | { type: "setChosenUnit"; key: string; unitLabel: string | null }
  | { type: "setRange"; key: string; range: ValueRange }
  | { type: "resetRanges" }
  | { type: "setSort"; sort: StatisticsSort }
  | { type: "setGroupBy"; groupBy: GroupBy };

export function statisticsViewReducer(
  state: StatisticsViewState,
  action: StatisticsViewAction,
): StatisticsViewState {
  switch (action.type) {
    case "toggleColumn": {
      const hiddenColumnKeys = new Set(state.hiddenColumnKeys);
      const isHiding = !hiddenColumnKeys.delete(action.key);
      if (isHiding) {
        hiddenColumnKeys.add(action.key);
      }
      // Ant Design only sorts columns that are present in the table, so hiding the sorted column
      // clears the sort instead of leaving the rail and table out of sync.
      const sort = isHiding && state.sort?.key === action.key ? null : state.sort;
      return { ...state, hiddenColumnKeys, sort };
    }
    case "setChosenUnit":
      return {
        ...state,
        chosenUnits:
          action.unitLabel == null
            ? omitKey(state.chosenUnits, action.key)
            : { ...state.chosenUnits, [action.key]: action.unitLabel },
      };
    case "setRange":
      return {
        ...state,
        ranges:
          action.range[0] == null && action.range[1] == null
            ? omitKey(state.ranges, action.key)
            : { ...state.ranges, [action.key]: action.range },
      };
    case "resetRanges":
      return { ...state, ranges: {} };
    case "setSort": {
      // Sorting by a hidden column makes it visible again so the table actually applies the sort.
      if (action.sort != null && state.hiddenColumnKeys.has(action.sort.key)) {
        const hiddenColumnKeys = new Set(state.hiddenColumnKeys);
        hiddenColumnKeys.delete(action.sort.key);
        return { ...state, hiddenColumnKeys, sort: action.sort };
      }
      return { ...state, sort: action.sort };
    }
    case "setGroupBy":
      return { ...state, groupBy: action.groupBy };
  }
}

export function useStatisticsView(
  initialState: StatisticsViewState = DEFAULT_VIEW_STATE,
): StatisticsView {
  const [state, dispatch] = useReducer(statisticsViewReducer, initialState);

  const toggleColumn = useCallback((key: string) => dispatch({ type: "toggleColumn", key }), []);
  const setChosenUnit = useCallback(
    (key: string, unitLabel: string | null) => dispatch({ type: "setChosenUnit", key, unitLabel }),
    [],
  );
  const setRange = useCallback(
    (key: string, range: ValueRange) => dispatch({ type: "setRange", key, range }),
    [],
  );
  const resetRanges = useCallback(() => dispatch({ type: "resetRanges" }), []);
  const setSort = useCallback((sort: StatisticsSort) => dispatch({ type: "setSort", sort }), []);
  const setGroupBy = useCallback(
    (groupBy: GroupBy) => dispatch({ type: "setGroupBy", groupBy }),
    [],
  );

  return useMemo(
    () => ({ ...state, toggleColumn, setChosenUnit, setRange, resetRanges, setSort, setGroupBy }),
    [state, toggleColumn, setChosenUnit, setRange, resetRanges, setSort, setGroupBy],
  );
}
