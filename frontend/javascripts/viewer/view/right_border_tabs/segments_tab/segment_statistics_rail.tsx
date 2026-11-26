import {
  EyeInvisibleOutlined,
  EyeOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from "@ant-design/icons";
import { Button, Card, Flex, InputNumber, Select, Tag, Tooltip, Typography, theme } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { LongUnitToShortUnitMap } from "viewer/constants";
import type { SegmentStatisticsRow, StatisticCategory } from "./segment_statistics_helpers";
import {
  type ColumnSpec,
  computeHistogram,
  formatStatisticNumber,
  getSelectableUnits,
  type Histogram,
  isRangeInverted,
  type ResolvedUnit,
  type StatisticsView,
  type ValueRange,
} from "./segment_statistics_view";

const CATEGORIES: StatisticCategory[] = ["Size", "Shape", "Location"];
const HISTOGRAM_BIN_COUNT = 26;
const HISTOGRAM_HEIGHT = 36;
const AUTOMATIC_UNIT = "auto";

function StatisticHistogram({
  histogram,
  range,
  isHighlighted,
}: {
  histogram: Histogram;
  range: ValueRange | undefined;
  isHighlighted: boolean;
}) {
  const { token } = theme.useToken();
  const { bins, min, max } = histogram;
  const maxCount = Math.max(1, ...bins);
  const binWidth = (max - min) / bins.length;
  const isInverted = isRangeInverted(range);
  return (
    <Flex align="flex-end" gap={1} style={{ height: HISTOGRAM_HEIGHT }} aria-hidden>
      {bins.map((count, index) => {
        const binStart = min + index * binWidth;
        const binEnd = binStart + binWidth;
        const isInRange =
          !isInverted &&
          (range == null ||
            ((range[0] == null || binEnd >= range[0]) &&
              (range[1] == null || binStart <= range[1])));
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the bins have a fixed order
            key={index}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 1,
              // Empty bins keep a sliver, so that the extent of the histogram stays visible.
              height: `${Math.max(6, (count / maxCount) * 100)}%`,
              background: isInRange
                ? isHighlighted
                  ? token.colorPrimary
                  : token.colorPrimaryBorder
                : token.colorFillSecondary,
            }}
          />
        );
      })}
    </Flex>
  );
}

function RangeFilter({
  spec,
  unit,
  histogram,
  range,
  onChange,
}: {
  spec: ColumnSpec;
  unit: ResolvedUnit;
  histogram: Histogram | null;
  range: ValueRange | undefined;
  onChange: (range: ValueRange) => void;
}) {
  const [min, max] = range ?? [null, null];
  const isInverted = isRangeInverted(range);
  // The bounds are stored in the base unit of the statistic, but edited in the displayed one.
  const toDisplayed = (bound: number | null) => (bound == null ? null : bound / unit.factor);
  const fromDisplayed = (bound: number | null) => (bound == null ? null : bound * unit.factor);
  return (
    <Flex align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
      <InputNumber
        size="small"
        controls={false}
        status={isInverted ? "error" : undefined}
        style={{ flex: 1, minWidth: 0 }}
        aria-label={`${spec.title} minimum`}
        placeholder={
          histogram != null ? formatStatisticNumber(histogram.min, spec.value, unit) : "Min"
        }
        value={toDisplayed(min)}
        onChange={(bound) => onChange([fromDisplayed(bound), max])}
      />
      <Typography.Text type="secondary">–</Typography.Text>
      <InputNumber
        size="small"
        controls={false}
        status={isInverted ? "error" : undefined}
        style={{ flex: 1, minWidth: 0 }}
        aria-label={`${spec.title} maximum`}
        placeholder={
          histogram != null ? formatStatisticNumber(histogram.max, spec.value, unit) : "Max"
        }
        value={toDisplayed(max)}
        onChange={(bound) => onChange([min, fromDisplayed(bound)])}
      />
    </Flex>
  );
}

function StatisticCard({
  spec,
  unit,
  rows,
  view,
}: {
  spec: ColumnSpec;
  unit: ResolvedUnit;
  rows: SegmentStatisticsRow[];
  view: StatisticsView;
}) {
  const { token } = theme.useToken();
  const datasetUnit = useWkSelector(
    (state) => LongUnitToShortUnitMap[state.dataset.dataSource.scale.unit],
  );
  const { value } = spec;
  const isVisible = !view.hiddenColumnKeys.has(spec.key);
  const range = view.ranges[spec.key];
  const sortOrder = view.sort?.key === spec.key ? view.sort.order : null;
  const sortLabel =
    sortOrder === "descend"
      ? `Sorted descending by ${spec.title} – click to sort ascending`
      : sortOrder === "ascend"
        ? `Sorted ascending by ${spec.title} – click to sort descending`
        : `Sort by ${spec.title}`;
  const selectableUnits = getSelectableUnits(value, datasetUnit);

  const histogram = useMemo(
    () =>
      value.kind === "number"
        ? computeHistogram(
            rows.flatMap((row) => value.get(row) ?? []),
            HISTOGRAM_BIN_COUNT,
          )
        : null,
    [value, rows],
  );

  return (
    <Card
      size="small"
      style={{
        opacity: isVisible ? 1 : 0.6,
        borderColor: range != null ? token.colorPrimaryBorder : undefined,
      }}
      styles={{ body: { padding: 8 } }}
    >
      <Flex vertical gap={6}>
        <Flex align="center" gap={6}>
          <Tooltip title={isVisible ? "Hide column" : "Show column"}>
            <Button
              size="small"
              type={isVisible ? "primary" : "default"}
              icon={isVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              aria-label={`Show ${spec.title} column`}
              aria-pressed={isVisible}
              onClick={() => view.toggleColumn(spec.key)}
            />
          </Tooltip>
          <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>
            {spec.title}
          </Typography.Text>
          {selectableUnits.length > 0 ? (
            <Select
              size="small"
              variant="filled"
              popupMatchSelectWidth={false}
              aria-label={`Unit for ${spec.title}`}
              value={view.chosenUnits[spec.key] ?? AUTOMATIC_UNIT}
              onChange={(unitLabel) =>
                view.setChosenUnit(spec.key, unitLabel === AUTOMATIC_UNIT ? null : unitLabel)
              }
              // The automatic choice shows the unit it resolved to.
              labelRender={() => unit.label}
              options={[
                { value: AUTOMATIC_UNIT, label: "Automatic" },
                ...selectableUnits.map(({ label }) => ({ value: label, label })),
              ]}
            />
          ) : (
            <Tag style={{ marginInlineEnd: 0 }}>{unit.label}</Tag>
          )}
        </Flex>
        {value.kind === "number" && (histogram != null || range != null) ? (
          <>
            {histogram != null ? (
              <StatisticHistogram
                histogram={histogram}
                range={range}
                isHighlighted={sortOrder != null}
              />
            ) : null}
            <Flex align="center" gap={6}>
              <RangeFilter
                spec={spec}
                unit={unit}
                histogram={histogram}
                range={range}
                onChange={(newRange) => view.setRange(spec.key, newRange)}
              />
              <Tooltip title={sortLabel}>
                <Button
                  size="small"
                  type={sortOrder != null ? "primary" : "default"}
                  icon={
                    sortOrder === "ascend" ? <SortAscendingOutlined /> : <SortDescendingOutlined />
                  }
                  aria-label={sortLabel}
                  aria-pressed={sortOrder != null}
                  onClick={() =>
                    view.setSort({
                      key: spec.key,
                      order: sortOrder === "descend" ? "ascend" : "descend",
                    })
                  }
                />
              </Tooltip>
            </Flex>
          </>
        ) : null}
        {value.kind === "vector" ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {value.isPosition
              ? "x, y, z – click a value in the table to jump there"
              : value.getPosition != null
                ? "position · size – click the position to jump there, sorted by volume"
                : value.sortBy === "product"
                  ? "x, y, z – sorted by the volume of the box"
                  : "x, y, z"}
          </Typography.Text>
        ) : null}
      </Flex>
    </Card>
  );
}

type Props = {
  // All available statistics, including the ones whose column is hidden.
  columnSpecs: ColumnSpec[];
  units: Record<string, ResolvedUnit>;
  // The unfiltered rows, so that the histograms show what the filters select from.
  rows: SegmentStatisticsRow[];
  view: StatisticsView;
};

/*
 * The side rail of the segment statistics tab. It lists every statistic as a card, which toggles
 * its column, switches its unit, shows the distribution of its values and filters the rows by a
 * value range.
 */
export function SegmentStatisticsRail({ columnSpecs, units, rows, view }: Props) {
  const hasFilters = columnSpecs.some((spec) => view.ranges[spec.key] != null);
  return (
    <Flex vertical gap="small" style={{ height: "100%", minHeight: 0, paddingInlineEnd: 8 }}>
      <Flex align="center" style={{ minHeight: 24 }}>
        <Typography.Text strong style={{ flex: 1 }}>
          Stats & filters
        </Typography.Text>
        {hasFilters ? (
          <Button size="small" type="link" onClick={view.resetRanges}>
            Reset filters
          </Button>
        ) : null}
      </Flex>
      <Flex vertical gap={6} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {CATEGORIES.map((category) => {
          const specs = columnSpecs.filter((spec) => spec.category === category);
          if (specs.length === 0) return null;
          return (
            <Flex vertical gap={6} key={category}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {category}
              </Typography.Text>
              {specs.map((spec) => (
                <StatisticCard
                  key={spec.key}
                  spec={spec}
                  unit={units[spec.key]}
                  rows={rows}
                  view={view}
                />
              ))}
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
}
