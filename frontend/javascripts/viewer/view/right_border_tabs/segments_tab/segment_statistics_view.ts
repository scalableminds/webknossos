import { getBestUnitForValue, UnitsMap } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { UnitShort } from "viewer/constants";
import { setSegmentStatisticsViewAction } from "viewer/model/actions/ui_actions";
import type { SegmentStatisticsScope } from "viewer/store";
import Store from "viewer/store";
import type {
  SegmentStatisticsRow,
  StatisticSpec,
  StatisticValue,
} from "./segment_statistics_helpers";
import {
  DEFAULT_VIEW_STATE,
  type GroupBy,
  MAX_COMPARED_COUNT,
  type SortOrder,
  type StatisticsMode,
  type StatisticsSort,
  type StatisticsViewState,
  type ValueRange,
} from "./segment_statistics_view_state";

export {
  DEFAULT_VIEW_STATE,
  type GroupBy,
  MAX_COMPARED_COUNT,
  type SortOrder,
  type StatisticsMode,
  type StatisticsSort,
  type StatisticsViewState,
  type ValueRange,
} from "./segment_statistics_view_state";

/*
 * The state of the segment statistics view (which columns are shown, in which unit, how the rows
 * are filtered, sorted and grouped) together with the pure functions that apply it.
 */

// A statistic that is shown as a column.
export type ColumnSpec = StatisticSpec & { title: string; value: StatisticValue };

export type ResolvedUnit = { label: string; factor: number };

export const SEGMENT_COLUMN_KEY = "segment";
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

function updateViewState(update: (previous: StatisticsViewState) => StatisticsViewState) {
  Store.dispatch(
    setSegmentStatisticsViewAction(update(Store.getState().uiInformation.segmentStatisticsView)),
  );
}

const viewActions = {
  toggleColumn: (key: string) =>
    updateViewState((previous) => {
      const hiddenColumnKeys = new Set(previous.hiddenColumnKeys);
      if (!hiddenColumnKeys.delete(key)) {
        hiddenColumnKeys.add(key);
      }
      return { ...previous, hiddenColumnKeys };
    }),
  setChosenUnit: (key: string, unitLabel: string | null) =>
    updateViewState((previous) => ({
      ...previous,
      chosenUnits:
        unitLabel == null
          ? omitKey(previous.chosenUnits, key)
          : { ...previous.chosenUnits, [key]: unitLabel },
    })),
  setRange: (key: string, range: ValueRange) =>
    updateViewState((previous) => ({
      ...previous,
      ranges:
        range[0] == null && range[1] == null
          ? omitKey(previous.ranges, key)
          : { ...previous.ranges, [key]: range },
    })),
  resetRanges: () => updateViewState((previous) => ({ ...previous, ranges: {} })),
  setSort: (sort: StatisticsSort) => updateViewState((previous) => ({ ...previous, sort })),
  setGroupBy: (groupBy: GroupBy) => updateViewState((previous) => ({ ...previous, groupBy })),
  setMode: (mode: StatisticsMode) => updateViewState((previous) => ({ ...previous, mode })),
  setComparedKeys: (keys: string[]) =>
    updateViewState((previous) => ({
      ...previous,
      comparedKeys: keys.slice(0, MAX_COMPARED_COUNT),
    })),
};

/*
 * The view state lives in the store (and not in the tab), so that it survives switching to
 * another tab and can be restored from and written to a link.
 */
export function useStatisticsView(): StatisticsView {
  const state = useWkSelector((storeState) => storeState.uiInformation.segmentStatisticsView);
  return useMemo(() => ({ ...state, ...viewActions }), [state]);
}

// The part of the URL hash that restores the segment statistics tab. Only values that differ from
// the defaults are included. Segment ids are strings, as they can exceed the safe integer range.
export type SegmentStatisticsUrlState = {
  scope?: { groupId: number } | { segmentIds: string[] };
  groupBy?: GroupBy;
  mode?: StatisticsMode;
  sort?: { key: string; order: SortOrder } | null;
  hiddenColumns?: string[];
  units?: Record<string, string>;
  ranges?: Record<string, ValueRange>;
  compared?: string[];
};

export function toUrlState(
  viewState: StatisticsViewState,
  scope: SegmentStatisticsScope | null,
): SegmentStatisticsUrlState {
  const urlState: SegmentStatisticsUrlState = {};
  if (scope != null) {
    urlState.scope =
      scope.kind === "group"
        ? { groupId: scope.groupId }
        : { segmentIds: scope.segmentIds.map(String) };
  }
  if (viewState.groupBy !== DEFAULT_VIEW_STATE.groupBy) urlState.groupBy = viewState.groupBy;
  if (viewState.mode !== DEFAULT_VIEW_STATE.mode) urlState.mode = viewState.mode;
  if (
    viewState.sort?.key !== DEFAULT_VIEW_STATE.sort?.key ||
    viewState.sort?.order !== DEFAULT_VIEW_STATE.sort?.order
  ) {
    urlState.sort = viewState.sort;
  }
  if (viewState.hiddenColumnKeys.size > 0) {
    urlState.hiddenColumns = [...viewState.hiddenColumnKeys];
  }
  if (Object.keys(viewState.chosenUnits).length > 0) urlState.units = viewState.chosenUnits;
  if (Object.keys(viewState.ranges).length > 0) urlState.ranges = viewState.ranges;
  if (viewState.comparedKeys.length > 0) urlState.compared = viewState.comparedKeys;
  return urlState;
}

// The scope of a link refers to the segmentation layer that is visible when the link is opened
// (which the link restores as well). Without such a layer, the scope is dropped.
export function fromUrlState(
  urlState: SegmentStatisticsUrlState,
  layerName: string | null,
): {
  viewState: StatisticsViewState;
  scope: SegmentStatisticsScope | null;
} {
  const { scope } = urlState;
  return {
    scope:
      scope == null || layerName == null
        ? null
        : "groupId" in scope
          ? { kind: "group", layerName, groupId: scope.groupId }
          : "segmentIds" in scope
            ? { kind: "segments", layerName, segmentIds: scope.segmentIds.map(BigInt) }
            : null,
    viewState: {
      hiddenColumnKeys: new Set(urlState.hiddenColumns ?? []),
      chosenUnits: urlState.units ?? {},
      ranges: urlState.ranges ?? {},
      // An explicit null means "unsorted", whereas a missing value means the default.
      sort: urlState.sort !== undefined ? urlState.sort : DEFAULT_VIEW_STATE.sort,
      groupBy: urlState.groupBy ?? DEFAULT_VIEW_STATE.groupBy,
      mode: urlState.mode ?? DEFAULT_VIEW_STATE.mode,
      comparedKeys: (urlState.compared ?? []).slice(0, MAX_COMPARED_COUNT),
    },
  };
}
