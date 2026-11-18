import { Button, Flex, Progress, Spin, Table, type TableColumnType, Typography, theme } from "antd";
import { getBestUnitForValue } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { type ReactNode, useLayoutEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { LongUnitToShortUnitMap, type UnitShort, type Vector3 } from "viewer/constants";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getSegmentColorAsRGBA } from "viewer/model/accessors/volumetracing_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";
import { useSegmentSelection } from "./hooks/use_segment_selection";
import type {
  SegmentStatisticsRow,
  StatisticSpec,
  StatisticValue,
} from "./segment_statistics_helpers";

const SEGMENT_COLUMN_WIDTH = 220;
const NUMBER_COLUMN_WIDTH = 130;
const VECTOR_COLUMN_WIDTH = 180;
const DEFAULT_FRACTION_DIGITS = 2;
// Even the smallest value should get a visible bar.
const MIN_BAR_PERCENT = 2;

type ResolvedUnit = { label: string; factor: number };

/*
 * Reports how much vertical space is left for the body of the table inside of the container.
 * antd's virtual table needs an explicit pixel height and cannot simply fill its parent.
 */
function useTableBodyHeight() {
  // Held in state instead of a ref object, so that the measuring starts once the container appears.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useLayoutEffect(() => {
    if (container == null) {
      return;
    }
    const measure = () => {
      const headerHeight = container.querySelector(".ant-table-header")?.clientHeight ?? 0;
      setBodyHeight(Math.max(0, container.clientHeight - headerHeight));
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [container]);

  return { containerRef: setContainer, bodyHeight };
}

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

function formatNumber(number: number, fractionDigits: number): string {
  return number.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// Missing values are sorted as the smallest ones.
function getSortKey(value: StatisticValue, row: SegmentStatisticsRow): number[] {
  const rowValue = value.get(row);
  if (rowValue == null) return [Number.NEGATIVE_INFINITY];
  if (typeof rowValue === "number") return [rowValue];
  return value.kind === "vector" && value.sortBy === "product"
    ? [rowValue[0] * rowValue[1] * rowValue[2]]
    : rowValue;
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
  // Converted to a string within the selector, so that the result is stable across store updates.
  const color = useWkSelector((state) => {
    const [r, g, b] = getSegmentColorAsRGBA(state, row.segmentId, layerName);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  });
  return (
    <Flex align="center" gap="small" style={{ minWidth: 0 }}>
      <div
        style={{
          width: 3,
          alignSelf: "stretch",
          minHeight: 18,
          borderRadius: 2,
          background: color,
        }}
      />
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

function NumberCell({ text, barPercent }: { text: string; barPercent: number }) {
  const { token } = theme.useToken();
  return (
    <Flex vertical align="stretch">
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{text}</span>
      <Progress
        percent={barPercent}
        showInfo={false}
        size={{ height: 2 }}
        strokeLinecap="butt"
        strokeColor={token.colorPrimaryBorder}
        style={{ lineHeight: 0, margin: 0 }}
      />
    </Flex>
  );
}

function PositionCell({ position, layerName }: { position: Vector3; layerName: string }) {
  const dispatch = useDispatch();
  return (
    <Button
      type="link"
      size="small"
      style={{ padding: 0, fontVariantNumeric: "tabular-nums" }}
      title="Jump to this position"
      onClick={(event) => {
        // Don't select the segment of the row, which would jump to the segment's anchor position.
        event.stopPropagation();
        dispatch(
          setPositionAction(
            layerToGlobalTransformedPosition(position, layerName, "segmentation", Store.getState()),
          ),
        );
      }}
    >
      {position.join(", ")}
    </Button>
  );
}

function getStatisticColumn(
  spec: StatisticSpec & { title: string; value: StatisticValue },
  rows: SegmentStatisticsRow[],
  datasetUnit: UnitShort,
  layerName: string,
): TableColumnType<SegmentStatisticsRow> {
  const { value } = spec;
  const unit = resolveUnit(value, rows, datasetUnit);
  const fractionDigits = value.fractionDigits ?? DEFAULT_FRACTION_DIGITS;
  const renderPending = (render: () => ReactNode) => {
    if (spec.isLoading) return <Spin size="small" />;
    if (spec.isError) return "n/a";
    return render();
  };
  const sorter = (a: SegmentStatisticsRow, b: SegmentStatisticsRow) =>
    compareSortKeys(getSortKey(value, a), getSortKey(value, b));

  if (value.kind === "number") {
    const numbers = rows.flatMap((row) => value.get(row) ?? []);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return {
      key: spec.key,
      title: <ColumnTitle title={spec.title} unit={unit.label} align="end" />,
      width: NUMBER_COLUMN_WIDTH,
      align: "right",
      sorter,
      defaultSortOrder: spec.key === "volume" ? "descend" : undefined,
      render: (_, row) =>
        renderPending(() => {
          const number = value.get(row);
          if (number == null) return null;
          const barPercent = max > min ? ((number - min) / (max - min)) * 100 : 100;
          return (
            <NumberCell
              text={formatNumber(number / unit.factor, fractionDigits)}
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
    render: (_, row) =>
      renderPending(() => {
        const vector = value.get(row);
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
  rows: SegmentStatisticsRow[];
  statisticSpecs: StatisticSpec[];
  layerName: string;
};

/*
 * The table of the segment statistics tab. Each statistic is a sortable column in one common unit.
 * Clicking a row selects the segment (which is shared with the segments tab) and jumps to it.
 */
export function SegmentStatisticsTable({ rows, statisticSpecs, layerName }: Props) {
  const datasetUnit = useWkSelector(
    (state) => LongUnitToShortUnitMap[state.dataset.dataSource.scale.unit],
  );
  const { selectedSegmentIds, selectSegmentAndJumpToPosition } = useSegmentSelection();
  const selectedKeys = useMemo(
    () => new Set(selectedSegmentIds.map((segmentId) => segmentId.toString())),
    [selectedSegmentIds],
  );
  const { containerRef, bodyHeight } = useTableBodyHeight();

  const columns = useMemo((): TableColumnType<SegmentStatisticsRow>[] => {
    const segmentColumn: TableColumnType<SegmentStatisticsRow> = {
      key: "segment",
      title: <ColumnTitle title="Segment" unit="name · ID" align="start" />,
      width: SEGMENT_COLUMN_WIDTH,
      fixed: "left",
      sorter: (a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0),
      render: (_, row) => <SegmentCell row={row} layerName={layerName} />,
    };
    const statisticColumns = statisticSpecs.flatMap((spec) => {
      const { title, value } = spec;
      return title != null && value != null
        ? [getStatisticColumn({ ...spec, title, value }, rows, datasetUnit, layerName)]
        : [];
    });
    return [segmentColumn, ...statisticColumns];
  }, [statisticSpecs, rows, datasetUnit, layerName]);
  const totalColumnWidth = columns.reduce((sum, column) => sum + Number(column.width), 0);

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      <Table
        dataSource={rows}
        columns={columns}
        size="small"
        virtual
        pagination={false}
        showSorterTooltip={false}
        scroll={{ x: totalColumnWidth, y: bodyHeight }}
        rowClassName={(row) => (selectedKeys.has(row.key) ? "ant-table-row-selected" : "")}
        onRow={(row) => ({
          style: { cursor: "pointer" },
          onClick: () => selectSegmentAndJumpToPosition(row.segment),
        })}
      />
    </div>
  );
}
