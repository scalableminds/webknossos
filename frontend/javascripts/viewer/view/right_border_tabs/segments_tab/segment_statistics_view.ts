import { getBestUnitForValue, UnitsMap } from "libs/format_utils";
import { useCallback, useMemo, useState } from "react";
import { UnitShort } from "viewer/constants";
import type {
  SegmentStatisticsRow,
  StatisticSpec,
  StatisticValue,
} from "./segment_statistics_helpers";

/*
 * The state of the segment statistics view (which columns are shown, in which unit, how the rows
 * are filtered, sorted and grouped) together with the pure functions that apply it.
 */

// A statistic that is shown as a column.
export type ColumnSpec = StatisticSpec & { title: string; value: StatisticValue };

export type ResolvedUnit = { label: string; factor: number };

// Lower and upper bound in the base unit of the statistic (not the displayed one). Null is open.
export type ValueRange = [number | null, number | null];

export type SortOrder = "ascend" | "descend";
export type StatisticsSort = { key: string; order: SortOrder } | null;

export type GroupBy = "group" | "none";
export type StatisticsMode = "table" | "compare";

// More entities than this cannot be told apart in the comparison.
export const MAX_COMPARED_COUNT = 6;

export const SEGMENT_COLUMN_KEY = "segment";
const DEFAULT_SORT: StatisticsSort = { key: "volume", order: "descend" };
const DEFAULT_FRACTION_DIGITS = 2;

// The units that can be chosen for a column, besides the automatically chosen one.
const SELECTABLE_UNITS = [UnitShort.nm, UnitShort.µm, UnitShort.mm];

export function getColumnSpecs(statisticSpecs: StatisticSpec[]): ColumnSpec[] {
  return statisticSpecs.flatMap((spec) => {
    const { title, value } = spec;
    return title != null && value != null ? [{ ...spec, title, value }] : [];
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
    // The components of a vector are separated by commas, so they must not contain any themselves.
    useGrouping: value.kind !== "vector",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// Keeps the rows whose values lie within all ranges. Rows without a value for a filtered
// statistic are dropped, since they cannot be known to match.
export function filterRows(
  rows: SegmentStatisticsRow[],
  columnSpecs: ColumnSpec[],
  ranges: Record<string, ValueRange>,
): SegmentStatisticsRow[] {
  const activeFilters = columnSpecs.flatMap((spec) => {
    const range = ranges[spec.key];
    return range != null && spec.value.kind === "number" ? [{ value: spec.value, range }] : [];
  });
  if (activeFilters.length === 0) {
    return rows;
  }
  return rows.filter((row) =>
    activeFilters.every(({ value, range: [min, max] }) => {
      const number = value.get(row);
      return number != null && (min == null || number >= min) && (max == null || number <= max);
    }),
  );
}

export type Histogram = { bins: number[]; min: number; max: number };

export const HISTOGRAM_BIN_COUNT = 26;

// The share of the numbers that are not larger than the given one, in percent.
export function getPercentile(number: number, numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  return Math.round((numbers.filter((other) => other <= number).length / numbers.length) * 100);
}

export function getMedian(numbers: number[]): number | undefined {
  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  return sortedNumbers[Math.floor(sortedNumbers.length / 2)];
}

export function computeHistogram(numbers: number[], binCount: number): Histogram | null {
  if (numbers.length === 0) {
    return null;
  }
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const bins = new Array<number>(binCount).fill(0);
  for (const number of numbers) {
    const relativePosition = max > min ? (number - min) / (max - min) : 0;
    bins[Math.min(binCount - 1, Math.floor(relativePosition * binCount))]++;
  }
  return { bins, min, max };
}

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

export type StatisticsView = StatisticsViewState & {
  toggleColumn: (key: string) => void;
  setChosenUnit: (key: string, unitLabel: string | null) => void;
  setRange: (key: string, range: ValueRange) => void;
  resetRanges: () => void;
  setSort: (sort: StatisticsSort) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setMode: (mode: StatisticsMode) => void;
  setComparedKeys: (keys: string[]) => void;
};

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

export function useStatisticsView(
  initialState: StatisticsViewState = DEFAULT_VIEW_STATE,
): StatisticsView {
  const [state, setState] = useState(initialState);

  const toggleColumn = useCallback((key: string) => {
    setState((previous) => {
      const hiddenColumnKeys = new Set(previous.hiddenColumnKeys);
      if (!hiddenColumnKeys.delete(key)) {
        hiddenColumnKeys.add(key);
      }
      return { ...previous, hiddenColumnKeys };
    });
  }, []);

  const setChosenUnit = useCallback((key: string, unitLabel: string | null) => {
    setState((previous) => ({
      ...previous,
      chosenUnits:
        unitLabel == null
          ? omitKey(previous.chosenUnits, key)
          : { ...previous.chosenUnits, [key]: unitLabel },
    }));
  }, []);

  const setRange = useCallback((key: string, range: ValueRange) => {
    setState((previous) => ({
      ...previous,
      ranges:
        range[0] == null && range[1] == null
          ? omitKey(previous.ranges, key)
          : { ...previous.ranges, [key]: range },
    }));
  }, []);

  const resetRanges = useCallback(() => {
    setState((previous) => ({ ...previous, ranges: {} }));
  }, []);

  const setSort = useCallback((sort: StatisticsSort) => {
    setState((previous) => ({ ...previous, sort }));
  }, []);

  const setGroupBy = useCallback((groupBy: GroupBy) => {
    setState((previous) => ({ ...previous, groupBy }));
  }, []);

  const setMode = useCallback((mode: StatisticsMode) => {
    setState((previous) => ({ ...previous, mode }));
  }, []);

  const setComparedKeys = useCallback((keys: string[]) => {
    setState((previous) => ({ ...previous, comparedKeys: keys.slice(0, MAX_COMPARED_COUNT) }));
  }, []);

  return useMemo(
    () => ({
      ...state,
      toggleColumn,
      setChosenUnit,
      setRange,
      resetRanges,
      setSort,
      setGroupBy,
      setMode,
      setComparedKeys,
    }),
    [
      state,
      toggleColumn,
      setChosenUnit,
      setRange,
      resetRanges,
      setSort,
      setGroupBy,
      setMode,
      setComparedKeys,
    ],
  );
}
