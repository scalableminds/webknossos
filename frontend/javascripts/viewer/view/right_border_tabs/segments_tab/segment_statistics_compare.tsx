import { Card, Empty, Flex, Progress, Tag, Typography, theme } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import type { Vector3 } from "viewer/constants";
import { getSegmentColorAsRGBA } from "viewer/model/accessors/volumetracing_accessor";
import type { SegmentStatisticsRow } from "./segment_statistics_helpers";
import { StatisticHistogram } from "./segment_statistics_histogram";
import type { GroupTableRow } from "./segment_statistics_tree";
import {
  type ColumnSpec,
  computeHistogram,
  formatStatisticNumber,
  getMedian,
  getPercentile,
  HISTOGRAM_BIN_COUNT,
  type ResolvedUnit,
} from "./segment_statistics_view";

const AGGREGATION_NAMES = { sum: "total", mean: "average", max: "maximum" } as const;
const LABEL_WIDTH = 160;
const NAME_WIDTH = 120;
const VALUE_WIDTH = 110;
const PERCENTILE_WIDTH = 70;
const DISTRIBUTION_WIDTH = 200;
// Below this width, the bars are too short to be compared and the card wraps instead.
const MIN_BARS_WIDTH = 420;

// A segment or a group that takes part in the comparison.
type ComparedEntity = {
  key: string;
  name: string;
  color: string;
  isGroup: boolean;
  getNumber: (spec: ColumnSpec) => number | undefined;
  getVector: (spec: ColumnSpec) => Vector3 | undefined;
};

function useComparedEntities(
  comparedKeys: string[],
  rows: SegmentStatisticsRow[],
  groupRows: GroupTableRow[],
  layerName: string,
): ComparedEntity[] {
  const { token } = theme.useToken();
  const groupColor = token.colorTextSecondary;
  // Joined to a string within the selector, so that the result is stable across store updates.
  const segmentColors = useWkSelector((state) =>
    comparedKeys
      .map((key) => {
        const row = rows.find((candidate) => candidate.key === key);
        if (row == null) return "";
        const [r, g, b] = getSegmentColorAsRGBA(state, row.segmentId, layerName);
        return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      })
      .join("|"),
  );

  return useMemo(() => {
    const colors = segmentColors.split("|");
    return comparedKeys.flatMap((key, index): ComparedEntity[] => {
      const group = groupRows.find((candidate) => candidate.key === key);
      if (group != null) {
        return [
          {
            key,
            name: `${group.name} · ${group.segmentCount}`,
            color: groupColor,
            isGroup: true,
            getNumber: (spec) => group.aggregates[spec.key],
            getVector: () => undefined,
          },
        ];
      }
      const row = rows.find((candidate) => candidate.key === key);
      if (row == null) {
        // E.g. removed from the segment list or filtered out.
        return [];
      }
      return [
        {
          key,
          name: row.segmentName,
          color: colors[index],
          isGroup: false,
          getNumber: (spec) => {
            const number = spec.value.get(row);
            return typeof number === "number" ? number : undefined;
          },
          getVector: (spec) => {
            const vector = spec.value.get(row);
            return typeof vector === "number" ? undefined : vector;
          },
        },
      ];
    });
  }, [comparedKeys, rows, groupRows, segmentColors, groupColor]);
}

function EntityDot({ entity }: { entity: ComparedEntity }) {
  return (
    <span
      style={{
        display: "inline-block",
        flex: "none",
        width: 9,
        height: 9,
        // Groups are squares, segments are circles.
        borderRadius: entity.isGroup ? 2 : "50%",
        background: entity.color,
      }}
    />
  );
}

function NumberComparison({
  spec,
  unit,
  entities,
  rows,
}: {
  spec: ColumnSpec;
  unit: ResolvedUnit;
  entities: ComparedEntity[];
  rows: SegmentStatisticsRow[];
}) {
  const { value } = spec;
  const aggregation = value.kind === "number" ? (value.aggregation ?? "sum") : "sum";
  const numbers = useMemo(
    () =>
      rows.flatMap((row) => {
        const number = value.get(row);
        return typeof number === "number" ? [number] : [];
      }),
    [rows, value],
  );
  const histogram = useMemo(() => computeHistogram(numbers, HISTOGRAM_BIN_COUNT), [numbers]);
  const median = getMedian(numbers);
  const maxOfEntities = Math.max(...entities.map((entity) => entity.getNumber(spec) ?? 0));
  // A group's total is not comparable to the values of single segments, but its average or
  // maximum is. Only comparable values get a percentile and a marker in the distribution.
  const isOnSegmentScale = (entity: ComparedEntity) => !entity.isGroup || aggregation !== "sum";

  return (
    <Card size="small">
      <Flex gap="middle" align="stretch" wrap>
        <Flex vertical style={{ flex: "none", width: LABEL_WIDTH }}>
          <Typography.Text strong>{spec.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {unit.label} · groups show the {AGGREGATION_NAMES[aggregation]}
          </Typography.Text>
          {median != null ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: "auto" }}>
              median {formatStatisticNumber(median, value, unit)}
            </Typography.Text>
          ) : null}
        </Flex>
        <Flex
          vertical
          gap={6}
          justify="center"
          style={{ flex: `1 1 ${MIN_BARS_WIDTH}px`, minWidth: 0 }}
        >
          {entities.map((entity) => {
            const number = entity.getNumber(spec);
            return (
              <Flex key={entity.key} align="center" gap="small">
                <Flex align="center" gap={6} style={{ flex: "none", width: NAME_WIDTH }}>
                  <EntityDot entity={entity} />
                  <Typography.Text ellipsis={{ tooltip: entity.name }} style={{ minWidth: 0 }}>
                    {entity.name}
                  </Typography.Text>
                </Flex>
                <Progress
                  percent={number != null && maxOfEntities > 0 ? (number / maxOfEntities) * 100 : 0}
                  showInfo={false}
                  strokeColor={entity.color}
                  strokeLinecap="butt"
                  style={{ flex: 1, minWidth: 40, lineHeight: 0, margin: 0 }}
                />
                <Typography.Text
                  strong
                  style={{
                    flex: "none",
                    width: VALUE_WIDTH,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {number != null ? formatStatisticNumber(number, value, unit) : "–"}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ flex: "none", width: PERCENTILE_WIDTH, fontSize: 12 }}
                >
                  {number == null
                    ? ""
                    : isOnSegmentScale(entity)
                      ? `p${Math.min(99, getPercentile(number, numbers))}`
                      : "group total"}
                </Typography.Text>
              </Flex>
            );
          })}
        </Flex>
        {histogram != null ? (
          <Flex vertical gap={4} style={{ flex: "none", width: DISTRIBUTION_WIDTH }}>
            <StatisticHistogram
              histogram={histogram}
              height={44}
              markers={entities.flatMap((entity) => {
                const number = entity.getNumber(spec);
                return number != null && isOnSegmentScale(entity)
                  ? [{ key: entity.key, value: number, color: entity.color }]
                  : [];
              })}
            />
            <Flex justify="space-between">
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {formatStatisticNumber(histogram.min, value, unit)}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                all segments
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {formatStatisticNumber(histogram.max, value, unit)}
              </Typography.Text>
            </Flex>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}

function VectorComparison({
  specs,
  units,
  entities,
}: {
  specs: ColumnSpec[];
  units: Record<string, ResolvedUnit>;
  entities: ComparedEntity[];
}) {
  return (
    <Card size="small">
      <Flex vertical gap={6}>
        <Typography.Text strong>Location</Typography.Text>
        {specs.map((spec) => (
          <Flex key={spec.key} align="center" gap="small">
            <Typography.Text type="secondary" style={{ flex: "none", width: LABEL_WIDTH }}>
              {spec.title} ({units[spec.key].label})
            </Typography.Text>
            {entities.map((entity) => {
              const vector = entity.getVector(spec);
              return (
                <Typography.Text
                  key={entity.key}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    paddingInlineStart: 6,
                    borderInlineStart: `3px solid ${entity.color}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {vector != null
                    ? vector
                        .map((component) =>
                          formatStatisticNumber(component, spec.value, units[spec.key]),
                        )
                        .join(", ")
                    : "–"}
                </Typography.Text>
              );
            })}
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}

type Props = {
  comparedKeys: string[];
  onComparedKeysChange: (keys: string[]) => void;
  // The segments and groups the compared keys are resolved against (after filtering).
  rows: SegmentStatisticsRow[];
  groupRows: GroupTableRow[];
  // The unfiltered rows, which the distributions and percentiles refer to.
  allRows: SegmentStatisticsRow[];
  columnSpecs: ColumnSpec[];
  units: Record<string, ResolvedUnit>;
  layerName: string;
};

/*
 * Compares the picked segments and groups side by side: one card per numeric statistic that
 * relates the values to each other and to the distribution of all segments.
 */
export function SegmentStatisticsCompare({
  comparedKeys,
  onComparedKeysChange,
  rows,
  groupRows,
  allRows,
  columnSpecs,
  units,
  layerName,
}: Props) {
  const entities = useComparedEntities(comparedKeys, rows, groupRows, layerName);

  if (entities.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: "auto" }}
        description="Nothing to compare yet. Tick segments or groups in the table to compare them side by side."
      />
    );
  }

  const numberSpecs = columnSpecs.filter((spec) => spec.value.kind === "number");
  const vectorSpecs = columnSpecs.filter((spec) => spec.value.kind === "vector");

  return (
    <Flex vertical gap="small" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <Flex gap="small" wrap>
        {entities.map((entity) => (
          <Tag
            key={entity.key}
            closable
            onClose={() => onComparedKeysChange(comparedKeys.filter((key) => key !== entity.key))}
            icon={<EntityDot entity={entity} />}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginInlineEnd: 0 }}
          >
            {entity.name}
          </Tag>
        ))}
      </Flex>
      {numberSpecs.map((spec) => (
        <NumberComparison
          key={spec.key}
          spec={spec}
          unit={units[spec.key]}
          entities={entities}
          rows={allRows}
        />
      ))}
      {vectorSpecs.length > 0 ? (
        <VectorComparison specs={vectorSpecs} units={units} entities={entities} />
      ) : null}
    </Flex>
  );
}
