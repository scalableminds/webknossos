import { FolderOutlined } from "@ant-design/icons";
import { Button, Flex, Progress, Spin, Table, type TableColumnType, Typography, theme } from "antd";
import { formatNumber, getBestUnitForValue } from "libs/format_utils";
import { V4 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import max from "lodash-es/max";
import min from "lodash-es/min";
import { type ReactNode, useMemo, useState } from "react";
import {
  LongUnitToShortUnitMap,
  type UnitShort,
  type Vector3,
  type Vector4,
} from "viewer/constants";
import { getSegmentColorAsRGBA } from "viewer/model/accessors/volumetracing_accessor";
import { ColorDot } from "../shared/list_row";
import { useJumpToPosition } from "./hooks/use_jump_to_position";
import { useSegmentSelection } from "./hooks/use_segment_selection";
import { useTableBodyHeight } from "./hooks/use_table_body_height";
import type {
  SegmentStatisticsRow,
  StatisticSpec,
  StatisticValue,
} from "./segment_statistics_helpers";
import {
  type GroupTableRow,
  getAllGroupRows,
  type StatisticsTableRow,
} from "./segment_statistics_tree";

const SEGMENT_COLUMN_WIDTH = 220;
const NUMBER_COLUMN_WIDTH = 130;
const VECTOR_COLUMN_WIDTH = 180;
const DEFAULT_FRACTION_DIGITS = 2;
// Even the smallest value should get a visible bar.
const MIN_BAR_PERCENT = 2;
// Larger values are abbreviated (e.g. "123.4K") to fit into the column. This mostly affects the
// totals of groups, as the unit of a column is chosen to fit its segments.
const MIN_ABBREVIATED_VALUE = 1e5;
const compactNumberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCellNumber(number: number, fractionDigits: number): string {
  return Math.abs(number) >= MIN_ABBREVIATED_VALUE
    ? compactNumberFormat.format(number)
    : formatNumber(number, fractionDigits);
}

type ResolvedUnit = { label: string; factor: number };
type ValueSpec = StatisticSpec & { title: string; value: StatisticValue };

const AGGREGATION_LABELS = { sum: "total", mean: "avg", max: "max" } as const;

// All values of a column share one unit, so that they can be compared at a glance. A physical unit
// is chosen so that it fits the median value of the column.
function resolveUnit(
  value: StatisticValue,
  rows: SegmentStatisticsRow[],
  datasetUnit: UnitShort,
): ResolvedUnit {
  if (typeof value.unit === "string") {
    return { label: value.unit, factor: 1 };
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

// Missing values are sorted as the smallest ones. Groups are sorted by their aggregated values.
function getSortKey(spec: ValueSpec, tableRow: StatisticsTableRow): number[] {
  if (tableRow.kind === "group") {
    return [tableRow.aggregates[spec.key] ?? Number.NEGATIVE_INFINITY];
  }
  const { value } = spec;
  const rowValue = value.get(tableRow.row);
  if (rowValue == null) return [Number.NEGATIVE_INFINITY];
  if (typeof rowValue === "number") return [rowValue];
  return value.kind === "vector" && value.sortBy === "product"
    ? [rowValue[0] * rowValue[1] * rowValue[2]]
    : rowValue;
}

type SortOrder = "ascend" | "descend" | null | undefined;

// Wraps a comparison so that groups stay above the segments of the same level in both directions.
function createSorter(compare: (a: StatisticsTableRow, b: StatisticsTableRow) => number) {
  return (a: StatisticsTableRow, b: StatisticsTableRow, sortOrder?: SortOrder) => {
    if (a.kind !== b.kind) {
      const groupFirst = a.kind === "group" ? -1 : 1;
      return sortOrder === "descend" ? -groupFirst : groupFirst;
    }
    return compare(a, b);
  };
}

function compareSortKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0 && !Number.isNaN(difference)) return difference;
  }
  return 0;
}

function ColumnTitle({
  title,
  unit,
  align,
}: {
  title: string;
  unit: string;
  align: "start" | "end";
}) {
  return (
    <Flex vertical align={align}>
      <span>{title}</span>
      <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
        {unit}
      </Typography.Text>
    </Flex>
  );
}

function SegmentCell({ row, layerName }: { row: SegmentStatisticsRow; layerName: string }) {
  const segmentColorRGBA = useWkSelector(
    (state) => getSegmentColorAsRGBA(state, row.segmentId, layerName),
    (a: Vector4, b: Vector4) => V4.isEqual(a, b),
  );
  return (
    <Flex align="center" gap="small" style={{ minWidth: 0 }}>
      <ColorDot colorRGBA={segmentColorRGBA} />
      <Typography.Text ellipsis={{ tooltip: row.segmentName }} style={{ minWidth: 0 }}>
        {row.segmentName}
      </Typography.Text>
      {row.segment.name != null ? (
        <Typography.Text type="secondary" style={{ flex: "none" }}>
          {row.segmentId.toString()}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}

function GroupCell({ group }: { group: GroupTableRow }) {
  return (
    <Flex align="center" gap="small" style={{ minWidth: 0 }}>
      <FolderOutlined />
      <Typography.Text strong ellipsis={{ tooltip: group.name }} style={{ minWidth: 0 }}>
        {group.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ flex: "none" }}>
        {group.segmentCount}
      </Typography.Text>
    </Flex>
  );
}

function NumberCell({
  number,
  fractionDigits,
  barPercent,
  aggregationLabel,
}: {
  // Already converted to the unit of the column.
  number: number;
  fractionDigits: number;
  barPercent: number;
  // Set for the aggregated value of a group.
  aggregationLabel?: string;
}) {
  const { token } = theme.useToken();
  const isGroup = aggregationLabel != null;
  return (
    <Flex vertical align="stretch">
      <span
        title={formatNumber(number, fractionDigits)}
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontWeight: isGroup ? token.fontWeightStrong : undefined,
        }}
      >
        {formatCellNumber(number, fractionDigits)}
        {isGroup ? (
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
            {` ${aggregationLabel}`}
          </Typography.Text>
        ) : null}
      </span>
      <Progress
        percent={barPercent}
        showInfo={false}
        size={{ height: 2 }}
        strokeLinecap="butt"
        strokeColor={isGroup ? token.colorPrimary : token.colorPrimaryBorder}
        style={{ lineHeight: 0, margin: 0 }}
      />
    </Flex>
  );
}

function PositionCell({ position, layerName }: { position: Vector3; layerName: string }) {
  const jumpToPosition = useJumpToPosition();
  return (
    <Button
      type="link"
      size="small"
      style={{ padding: 0, fontVariantNumeric: "tabular-nums" }}
      title="Jump to this position"
      onClick={(event) => {
        // Don't select the segment of the row, which would jump to the segment's anchor position.
        event.stopPropagation();
        jumpToPosition(position, layerName);
      }}
    >
      {position.join(", ")}
    </Button>
  );
}

function getStatisticColumn(
  spec: ValueSpec,
  rows: SegmentStatisticsRow[],
  groupRows: GroupTableRow[],
  datasetUnit: UnitShort,
  layerName: string,
): TableColumnType<StatisticsTableRow> {
  const { value } = spec;
  const unit = resolveUnit(value, rows, datasetUnit);
  const fractionDigits = value.fractionDigits ?? DEFAULT_FRACTION_DIGITS;
  const renderPending = (render: () => ReactNode) => {
    if (spec.isLoading) return <Spin size="small" />;
    if (spec.isError) return "n/a";
    return render();
  };
  const sorter = createSorter((a, b) => compareSortKeys(getSortKey(spec, a), getSortKey(spec, b)));

  if (value.kind === "number") {
    const numbers = rows.flatMap((row) => value.get(row) ?? []);
    // Spreading many values into Math.min/max would exceed the maximum number of arguments.
    const minOfSegments = min(numbers) ?? 0;
    const maxOfSegments = max(numbers) ?? 0;
    // The bars of groups relate the groups to each other, as e.g. totals exceed any single segment.
    const maxOfGroups = max(groupRows.flatMap((group) => group.aggregates[spec.key] ?? [])) ?? 0;
    const aggregationLabel = AGGREGATION_LABELS[value.aggregation ?? "sum"];
    return {
      key: spec.key,
      title: <ColumnTitle title={spec.title} unit={unit.label} align="end" />,
      width: NUMBER_COLUMN_WIDTH,
      align: "right",
      sorter,
      defaultSortOrder: spec.key === "volume" ? "descend" : undefined,
      render: (_, tableRow) =>
        renderPending(() => {
          if (tableRow.kind === "group") {
            const aggregate = tableRow.aggregates[spec.key];
            if (aggregate == null) return null;
            const barPercent = maxOfGroups > 0 ? (aggregate / maxOfGroups) * 100 : 100;
            return (
              <NumberCell
                number={aggregate / unit.factor}
                fractionDigits={fractionDigits}
                barPercent={Math.max(MIN_BAR_PERCENT, barPercent)}
                aggregationLabel={aggregationLabel}
              />
            );
          }
          const number = value.get(tableRow.row);
          if (number == null) return null;
          const barPercent =
            maxOfSegments > minOfSegments
              ? ((number - minOfSegments) / (maxOfSegments - minOfSegments)) * 100
              : 100;
          return (
            <NumberCell
              number={number / unit.factor}
              fractionDigits={fractionDigits}
              barPercent={Math.max(MIN_BAR_PERCENT, barPercent)}
            />
          );
        }),
    };
  }

  return {
    key: spec.key,
    title: <ColumnTitle title={spec.title} unit={`x, y, z in ${unit.label}`} align="start" />,
    width: VECTOR_COLUMN_WIDTH,
    sorter,
    render: (_, tableRow) =>
      renderPending(() => {
        if (tableRow.kind === "group") {
          return <Typography.Text type="secondary">–</Typography.Text>;
        }
        const vector = value.get(tableRow.row);
        if (vector == null) return null;
        if (value.isPosition) {
          return <PositionCell position={vector} layerName={layerName} />;
        }
        return (
          <Typography.Text type="secondary" style={{ fontVariantNumeric: "tabular-nums" }}>
            {vector
              .map((component) => formatNumber(component / unit.factor, fractionDigits))
              .join(", ")}
          </Typography.Text>
        );
      }),
  };
}

type Props = {
  // All segments that are shown, used to relate the values of a column to each other.
  rows: SegmentStatisticsRow[];
  // The rows as they are arranged in the table: either flat or nested in groups.
  tableRows: StatisticsTableRow[];
  statisticSpecs: StatisticSpec[];
  layerName: string;
};

/*
 * The table of the segment statistics tab. Each statistic is a sortable column in one common unit.
 * Clicking a segment selects it (which is shared with the segments tab) and jumps to it. Clicking
 * a group collapses or expands it.
 */
export function SegmentStatisticsTable({ rows, tableRows, statisticSpecs, layerName }: Props) {
  const datasetUnit = useWkSelector(
    (state) => LongUnitToShortUnitMap[state.dataset.dataSource.scale.unit],
  );
  const { selectedSegmentIds, selectSegmentAndJumpToPosition } = useSegmentSelection();
  const selectedKeys = useMemo(
    () => new Set(selectedSegmentIds.map((segmentId) => segmentId.toString())),
    [selectedSegmentIds],
  );
  const { containerRef, bodyHeight } = useTableBodyHeight();

  const groupRows = useMemo(() => getAllGroupRows(tableRows), [tableRows]);
  // Groups are expanded unless the user collapsed them, so that new groups show their segments.
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());
  const expandedRowKeys = useMemo(
    () => groupRows.map((group) => group.key).filter((key) => !collapsedKeys.has(key)),
    [groupRows, collapsedKeys],
  );

  const columns = useMemo((): TableColumnType<StatisticsTableRow>[] => {
    const segmentColumn: TableColumnType<StatisticsTableRow> = {
      key: "segment",
      title: <ColumnTitle title="Segment" unit="name · ID" align="start" />,
      width: SEGMENT_COLUMN_WIDTH,
      fixed: "left",
      sorter: createSorter((a, b) => {
        if (a.kind === "group" && b.kind === "group") return a.name.localeCompare(b.name);
        if (a.kind === "segment" && b.kind === "segment") {
          return a.row.segmentId < b.row.segmentId ? -1 : a.row.segmentId > b.row.segmentId ? 1 : 0;
        }
        return 0;
      }),
      render: (_, tableRow) =>
        tableRow.kind === "group" ? (
          <GroupCell group={tableRow} />
        ) : (
          <SegmentCell row={tableRow.row} layerName={layerName} />
        ),
    };
    const statisticColumns = statisticSpecs.flatMap((spec) => {
      const { title, value } = spec;
      return title != null && value != null
        ? [getStatisticColumn({ ...spec, title, value }, rows, groupRows, datasetUnit, layerName)]
        : [];
    });
    return [segmentColumn, ...statisticColumns];
  }, [statisticSpecs, rows, groupRows, datasetUnit, layerName]);
  const totalColumnWidth = columns.reduce((sum, column) => sum + Number(column.width), 0);

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      <Table
        dataSource={tableRows}
        columns={columns}
        size="small"
        virtual
        pagination={false}
        showSorterTooltip={false}
        scroll={{ x: totalColumnWidth, y: bodyHeight }}
        expandable={{
          expandedRowKeys,
          expandRowByClick: true,
          onExpand: (isExpanded, tableRow) =>
            setCollapsedKeys((previousKeys) => {
              const keys = new Set(previousKeys);
              if (isExpanded) keys.delete(tableRow.key);
              else keys.add(tableRow.key);
              return keys;
            }),
        }}
        rowClassName={(tableRow) =>
          selectedKeys.has(tableRow.key) ? "ant-table-row-selected" : ""
        }
        onRow={(tableRow) => ({
          style: { cursor: "pointer" },
          onClick:
            tableRow.kind === "segment"
              ? () => selectSegmentAndJumpToPosition(tableRow.row.segment)
              : undefined,
        })}
      />
    </div>
  );
}
