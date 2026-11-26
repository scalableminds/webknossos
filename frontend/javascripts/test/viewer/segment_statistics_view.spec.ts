import { UnitShort } from "viewer/constants";
import type { Segment, SegmentGroup } from "viewer/store";
import type { SegmentStatisticsRow } from "viewer/view/right_border_tabs/segments_tab/segment_statistics_helpers";
import {
  buildGroupedTableRows,
  getAllGroupRows,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_tree";
import {
  type ColumnSpec,
  computeHistogram,
  DEFAULT_VIEW_STATE,
  filterRows,
  formatStatisticNumber,
  getSelectableUnits,
  isRangeInverted,
  resolveUnit,
  statisticsViewReducer,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_view";
import { describe, expect, it } from "vitest";

const createRow = (
  id: number,
  volume: number | undefined,
  options?: { sphericity?: number; groupId?: number | null },
): SegmentStatisticsRow => ({
  key: `${id}`,
  segment: { id: BigInt(id) } as Segment,
  additionalCoordinates: "",
  segmentId: BigInt(id),
  segmentName: `Segment ${id}`,
  groupId: options?.groupId ?? null,
  groupName: "",
  volumeInUnit3: volume,
  sphericity: options?.sphericity,
});

const volumeSpec: ColumnSpec = {
  key: "volume",
  title: "Volume",
  category: "Size",
  value: { kind: "number", unit: { dimension: 3 }, get: (row) => row.volumeInUnit3 },
  csvHeaders: [],
  getCsvValues: () => [],
};

const sphericitySpec: ColumnSpec = {
  key: "sphericity",
  title: "Sphericity",
  category: "Shape",
  value: { kind: "number", unit: "0–1", aggregation: "mean", get: (row) => row.sphericity },
  csvHeaders: [],
  getCsvValues: () => [],
};

const rows = [
  createRow(1, 0, { sphericity: 0.2, groupId: 1 }),
  createRow(2, 5e9, { sphericity: 0.8, groupId: 1 }),
  createRow(3, 9e9, { sphericity: 0.5, groupId: 1 }),
  createRow(4, undefined, { sphericity: 0.9, groupId: 1 }),
];

describe("segment statistics view", () => {
  it("filters rows by value ranges and drops rows without a value", () => {
    const keys = (range: [number | null, number | null]) =>
      filterRows(rows, [volumeSpec], { volume: range }).map((row) => row.key);
    expect(keys([2e9, null])).toEqual(["2", "3"]);
    expect(keys([null, 5e9])).toEqual(["1", "2"]);
    expect(keys([0, 5e9])).toEqual(["1", "2"]);
    expect(keys([5e9, 5e9])).toEqual(["2"]);
    // Inverted range matches nothing.
    expect(keys([6e9, 2e9])).toEqual([]);
    // Without any range, all rows are kept, including the ones without a value.
    expect(filterRows(rows, [volumeSpec], {})).toBe(rows);
    // Ranges for unavailable columns are ignored.
    expect(filterRows(rows, [volumeSpec], { missing: [0, 1] })).toBe(rows);
  });

  it("combines multiple active filters and skips loading or errored specs", () => {
    const filtered = filterRows(rows, [volumeSpec, sphericitySpec], {
      volume: [1e9, null],
      sphericity: [0.6, null],
    });
    expect(filtered.map((row) => row.key)).toEqual(["2"]);

    const loadingSpec: ColumnSpec = { ...volumeSpec, isLoading: true };
    const erroredSpec: ColumnSpec = { ...volumeSpec, isError: true };
    expect(filterRows(rows, [loadingSpec], { volume: [1e9, 6e9] })).toBe(rows);
    expect(filterRows(rows, [erroredSpec], { volume: [1e9, 6e9] })).toBe(rows);
  });

  it("aggregates only the filtered rows in group rows", () => {
    const groups: SegmentGroup[] = [{ groupId: 1, name: "Group A", children: [] }];
    const filtered = filterRows(rows, [volumeSpec], { volume: [2e9, 6e9] });
    const [groupRow] = getAllGroupRows(buildGroupedTableRows(filtered, groups, [volumeSpec]));
    expect(groupRow.segmentCount).toBe(1);
    expect(groupRow.aggregates.volume).toBe(5e9);
  });

  it("detects inverted ranges", () => {
    expect(isRangeInverted(undefined)).toBe(false);
    expect(isRangeInverted([null, 5])).toBe(false);
    expect(isRangeInverted([5, null])).toBe(false);
    expect(isRangeInverted([5, 5])).toBe(false);
    expect(isRangeInverted([2, 5])).toBe(false);
    expect(isRangeInverted([6, 5])).toBe(true);
  });

  it("resolves the unit of a column from the median unless one was chosen", () => {
    expect(resolveUnit(volumeSpec.value, rows, UnitShort.nm)).toEqual({
      label: "µm³",
      factor: 1e9,
    });
    expect(resolveUnit(volumeSpec.value, rows, UnitShort.nm, "nm³")).toEqual({
      label: "nm³",
      factor: 1,
    });
    // Unknown chosen unit falls back to automatic selection.
    expect(resolveUnit(volumeSpec.value, rows, UnitShort.nm, "km³")).toEqual({
      label: "µm³",
      factor: 1e9,
    });
    expect(getSelectableUnits(volumeSpec.value, UnitShort.nm).map((unit) => unit.label)).toEqual([
      "nm³",
      "µm³",
      "mm³",
    ]);
    expect(getSelectableUnits(volumeSpec.value, UnitShort.µm)).toEqual([
      { label: "nm³", factor: 1e-9 },
      { label: "µm³", factor: 1 },
      { label: "mm³", factor: 1e9 },
    ]);
    expect(getSelectableUnits({ kind: "number", unit: "vx", get: () => 1 }, UnitShort.nm)).toEqual(
      [],
    );
  });

  it("formats numbers in the unit of the column", () => {
    const unit = { label: "µm³", factor: 1e9 };
    expect(formatStatisticNumber(5e9, volumeSpec.value, unit)).toBe("5.00");
    expect(formatStatisticNumber(1234.5e9, volumeSpec.value, unit)).toBe("1,234.50");
    // Values that are too small for the decimal places are not shown as zero.
    expect(formatStatisticNumber(1.3e6, volumeSpec.value, unit)).toBe("0.0013");
    expect(formatStatisticNumber(0, volumeSpec.value, unit)).toBe("0.00");
  });

  it("computes a histogram", () => {
    expect(computeHistogram([], 4)).toBeNull();
    expect(computeHistogram([0, 1, 2, 3, 4, 8], 4)).toEqual({ bins: [2, 2, 1, 1], min: 0, max: 8 });
    // All values equal: everything lands in the first bin.
    expect(computeHistogram([3, 3], 2)).toEqual({ bins: [2, 0], min: 3, max: 3 });
  });

  it("keeps hidden columns, sort, units and ranges consistent in the view reducer", () => {
    // Hiding the currently sorted column clears the sort.
    const afterHideVolume = statisticsViewReducer(DEFAULT_VIEW_STATE, {
      type: "toggleColumn",
      key: "volume",
    });
    expect(afterHideVolume.hiddenColumnKeys.has("volume")).toBe(true);
    expect(afterHideVolume.sort).toBeNull();

    // Sorting by a hidden column makes it visible again.
    const afterSortVolume = statisticsViewReducer(afterHideVolume, {
      type: "setSort",
      sort: { key: "volume", order: "ascend" },
    });
    expect(afterSortVolume.hiddenColumnKeys.has("volume")).toBe(false);
    expect(afterSortVolume.sort).toEqual({ key: "volume", order: "ascend" });

    // Hiding a different column keeps the active sort.
    const afterHideOther = statisticsViewReducer(afterSortVolume, {
      type: "toggleColumn",
      key: "sphericity",
    });
    expect(afterHideOther.hiddenColumnKeys.has("sphericity")).toBe(true);
    expect(afterHideOther.sort).toEqual({ key: "volume", order: "ascend" });

    // Setting a unit and clearing it back to automatic.
    const withUnit = statisticsViewReducer(DEFAULT_VIEW_STATE, {
      type: "setChosenUnit",
      key: "volume",
      unitLabel: "nm³",
    });
    expect(withUnit.chosenUnits).toEqual({ volume: "nm³" });
    expect(
      statisticsViewReducer(withUnit, { type: "setChosenUnit", key: "volume", unitLabel: null })
        .chosenUnits,
    ).toEqual({});

    // Setting a range, clearing it via [null, null], and resetting all ranges.
    const withRange = statisticsViewReducer(DEFAULT_VIEW_STATE, {
      type: "setRange",
      key: "volume",
      range: [1, 10],
    });
    expect(withRange.ranges).toEqual({ volume: [1, 10] });
    expect(
      statisticsViewReducer(withRange, { type: "setRange", key: "volume", range: [null, null] })
        .ranges,
    ).toEqual({});
    expect(statisticsViewReducer(withRange, { type: "resetRanges" }).ranges).toEqual({});
  });
});
