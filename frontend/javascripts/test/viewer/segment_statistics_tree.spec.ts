import type { Segment, SegmentGroup } from "viewer/store";
import type {
  SegmentStatisticsRow,
  StatisticSpec,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_helpers";
import {
  aggregateNumbers,
  buildGroupedTableRows,
  getAllGroupRows,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_tree";
import { describe, expect, it } from "vitest";

const createRow = (
  id: number,
  groupId: number | null,
  volume: number | undefined,
  sphericity?: number,
): SegmentStatisticsRow => ({
  key: `${id}`,
  segment: { id: BigInt(id) } as Segment,
  additionalCoordinates: "",
  segmentId: BigInt(id),
  segmentName: `Segment ${id}`,
  groupId,
  groupName: "",
  volumeInUnit3: volume,
  sphericity,
});

const specs: StatisticSpec[] = [
  { key: "segmentId", csvHeaders: [], getCsvValues: () => [] },
  {
    key: "volume",
    title: "Volume",
    value: { kind: "number", unit: { dimension: 3 }, get: (row) => row.volumeInUnit3 },
    csvHeaders: [],
    getCsvValues: () => [],
  },
  {
    key: "sphericity",
    title: "Sphericity",
    value: { kind: "number", unit: "0–1", aggregation: "mean", get: (row) => row.sphericity },
    csvHeaders: [],
    getCsvValues: () => [],
  },
];

// 1
// ├─ 2
// └─ 3 (empty)
// 4 (empty)
const groups: SegmentGroup[] = [
  {
    groupId: 1,
    name: "Dendrites",
    children: [
      { groupId: 2, name: "Proximal", children: [] },
      { groupId: 3, name: "Distal", children: [] },
    ],
  },
  { groupId: 4, name: "Axons", children: [] },
];

describe("segment statistics tree", () => {
  it("aggregates numbers", () => {
    expect(aggregateNumbers([1, 2, 6], "sum")).toBe(9);
    expect(aggregateNumbers([1, 2, 6], "mean")).toBe(3);
    expect(aggregateNumbers([1, 2, 6], "max")).toBe(6);
    expect(aggregateNumbers([], "sum")).toBeUndefined();
  });

  it("nests rows along the group hierarchy and aggregates recursively", () => {
    const rows = [
      createRow(10, 1, 5, 0.2),
      createRow(11, 2, 7, 0.4),
      createRow(12, 2, undefined, 0.6),
      createRow(13, null, 100),
      // Refers to a group that does not exist (anymore).
      createRow(14, 99, 1),
    ];
    const tableRows = buildGroupedTableRows(rows, groups, specs);

    // The empty group 4 is omitted; ungrouped segments follow the groups.
    expect(tableRows.map((tableRow) => tableRow.key)).toEqual(["group-1", "13", "14"]);

    const [dendrites] = getAllGroupRows(tableRows);
    expect(dendrites.segmentCount).toBe(3);
    expect(dendrites.aggregates.volume).toBe(12);
    expect(dendrites.aggregates.sphericity).toBeCloseTo(0.4);
    // The empty subgroup 3 is omitted; subgroups come before the group's own segments.
    expect(dendrites.children.map((tableRow) => tableRow.key)).toEqual(["group-2", "10"]);

    const proximal = getAllGroupRows(tableRows)[1];
    expect(proximal.name).toBe("Proximal");
    expect(proximal.segmentCount).toBe(2);
    // Missing values are ignored.
    expect(proximal.aggregates.volume).toBe(7);
  });

  it("leaves aggregates undefined while no value is available", () => {
    const tableRows = buildGroupedTableRows([createRow(10, 4, undefined)], groups, specs);
    expect(getAllGroupRows(tableRows)[0].aggregates.volume).toBeUndefined();
  });
});
