import max from "lodash-es/max";
import type { SegmentGroup } from "viewer/store";
import type {
  SegmentStatisticsRow,
  StatisticAggregation,
  StatisticSpec,
} from "./segment_statistics_helpers";

export type SegmentTableRow = {
  kind: "segment";
  key: string;
  row: SegmentStatisticsRow;
};

export type GroupTableRow = {
  kind: "group";
  key: string;
  groupId: number;
  name: string;
  // Includes the segments of all subgroups.
  segmentCount: number;
  // The aggregated value of each numeric statistic, by the key of its spec. Undefined as long as
  // none of the group's segments has a value.
  aggregates: Record<string, number | undefined>;
  children: StatisticsTableRow[];
};

export type StatisticsTableRow = SegmentTableRow | GroupTableRow;

export function getGroupRowKey(groupId: number): string {
  return `group-${groupId}`;
}

export function aggregateNumbers(
  numbers: number[],
  aggregation: StatisticAggregation,
): number | undefined {
  if (numbers.length === 0) {
    return undefined;
  }
  if (aggregation === "max") {
    // Spreading a large array into Math.max would exceed the maximum number of arguments.
    return max(numbers);
  }
  const sum = numbers.reduce((a, b) => a + b, 0);
  return aggregation === "mean" ? sum / numbers.length : sum;
}

export function toSegmentTableRows(rows: SegmentStatisticsRow[]): SegmentTableRow[] {
  return rows.map((row) => ({ kind: "segment", key: row.key, row }));
}

/*
 * Arranges the rows along the hierarchy of the segment groups. Each group row carries the
 * aggregated statistics of all segments below it. Groups without any of the given segments are
 * omitted, and segments that don't belong to a (known) group are put on the top level.
 */
export function buildGroupedTableRows(
  rows: SegmentStatisticsRow[],
  segmentGroups: SegmentGroup[],
  statisticSpecs: StatisticSpec[],
): StatisticsTableRow[] {
  const rowsByGroupId = new Map<number, SegmentStatisticsRow[]>();
  const knownGroupIds = new Set<number>();
  const collectGroupIds = (groups: SegmentGroup[]) => {
    for (const group of groups) {
      knownGroupIds.add(group.groupId);
      collectGroupIds(group.children);
    }
  };
  collectGroupIds(segmentGroups);

  const ungroupedRows: SegmentStatisticsRow[] = [];
  for (const row of rows) {
    if (row.groupId == null || !knownGroupIds.has(row.groupId)) {
      ungroupedRows.push(row);
      continue;
    }
    const groupRows = rowsByGroupId.get(row.groupId);
    if (groupRows != null) {
      groupRows.push(row);
    } else {
      rowsByGroupId.set(row.groupId, [row]);
    }
  }

  const numericSpecs = statisticSpecs.flatMap((spec) =>
    spec.value?.kind === "number" ? [{ key: spec.key, value: spec.value }] : [],
  );

  // Returns the group's table row together with all segment rows below it, which the parent needs
  // for its own aggregation.
  const buildGroup = (
    group: SegmentGroup,
  ): { tableRow: GroupTableRow; allRows: SegmentStatisticsRow[] } | null => {
    const directRows = rowsByGroupId.get(group.groupId) ?? [];
    const subgroups = group.children.flatMap((child) => buildGroup(child) ?? []);
    const allRows = [...directRows, ...subgroups.flatMap((subgroup) => subgroup.allRows)];
    if (allRows.length === 0) {
      return null;
    }
    const aggregates: Record<string, number | undefined> = {};
    for (const { key, value } of numericSpecs) {
      aggregates[key] = aggregateNumbers(
        allRows.flatMap((row) => value.get(row) ?? []),
        value.aggregation ?? "sum",
      );
    }
    return {
      allRows,
      tableRow: {
        kind: "group",
        key: getGroupRowKey(group.groupId),
        groupId: group.groupId,
        name: group.name,
        segmentCount: allRows.length,
        aggregates,
        children: [
          ...subgroups.map((subgroup) => subgroup.tableRow),
          ...toSegmentTableRows(directRows),
        ],
      },
    };
  };

  return [
    ...segmentGroups.flatMap((group) => buildGroup(group)?.tableRow ?? []),
    ...toSegmentTableRows(ungroupedRows),
  ];
}

export function getAllGroupRows(tableRows: StatisticsTableRow[]): GroupTableRow[] {
  return tableRows.flatMap((tableRow) =>
    tableRow.kind === "group" ? [tableRow, ...getAllGroupRows(tableRow.children)] : [],
  );
}
