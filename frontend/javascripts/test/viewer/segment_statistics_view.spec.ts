import { UnitShort } from "viewer/constants";
import type { Segment } from "viewer/store";
import type { SegmentStatisticsRow } from "viewer/view/right_border_tabs/segments_tab/segment_statistics_helpers";
import {
  type ColumnSpec,
  computeHistogram,
  filterRows,
  formatStatisticNumber,
  getMedian,
  getPercentile,
  getSelectableUnits,
  resolveUnit,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_view";
import { describe, expect, it } from "vitest";

const createRow = (id: number, volume: number | undefined): SegmentStatisticsRow => ({
  key: `${id}`,
  segment: { id: BigInt(id) } as Segment,
  additionalCoordinates: "",
  segmentId: BigInt(id),
  segmentName: `Segment ${id}`,
  groupId: null,
  groupName: "",
  volumeInUnit3: volume,
});

const volumeSpec: ColumnSpec = {
  key: "volume",
  title: "Volume",
  value: { kind: "number", unit: { dimension: 3 }, get: (row) => row.volumeInUnit3 },
  csvHeaders: [],
  getCsvValues: () => [],
};

const rows = [createRow(1, 1e9), createRow(2, 5e9), createRow(3, 9e9), createRow(4, undefined)];

describe("segment statistics view", () => {
  it("filters rows by value ranges and drops rows without a value", () => {
    const keys = (range: [number | null, number | null]) =>
      filterRows(rows, [volumeSpec], { volume: range }).map((row) => row.key);
    expect(keys([2e9, null])).toEqual(["2", "3"]);
    expect(keys([null, 5e9])).toEqual(["1", "2"]);
    expect(keys([2e9, 6e9])).toEqual(["2"]);
    // Without any range, all rows are kept, including the ones without a value.
    expect(filterRows(rows, [volumeSpec], {})).toBe(rows);
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
    expect(getSelectableUnits(volumeSpec.value, UnitShort.nm).map((unit) => unit.label)).toEqual([
      "nm³",
      "µm³",
      "mm³",
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

  it("does not group the digits of vector components", () => {
    const sizeValue = {
      kind: "vector",
      unit: "vx",
      fractionDigits: 0,
      sortBy: "product",
      get: () => undefined,
    } as const;
    expect(formatStatisticNumber(12345, sizeValue, { label: "vx", factor: 1 })).toBe("12345");
  });

  it("computes percentiles and the median", () => {
    expect(getPercentile(3, [1, 2, 3, 4])).toBe(75);
    expect(getPercentile(0, [1, 2])).toBe(0);
    expect(getPercentile(1, [])).toBe(0);
    expect(getMedian([5, 1, 3])).toBe(3);
    expect(getMedian([])).toBeUndefined();
  });

  it("computes a histogram", () => {
    expect(computeHistogram([], 4)).toBeNull();
    expect(computeHistogram([0, 1, 2, 3, 4, 8], 4)).toEqual({ bins: [2, 2, 1, 1], min: 0, max: 8 });
    // All values equal: everything lands in the first bin.
    expect(computeHistogram([3, 3], 2)).toEqual({ bins: [2, 0], min: 3, max: 3 });
  });
});
