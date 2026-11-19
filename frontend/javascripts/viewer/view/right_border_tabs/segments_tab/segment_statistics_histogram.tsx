import { Flex, theme } from "antd";
import type { Histogram, ValueRange } from "./segment_statistics_view";

const DEFAULT_HEIGHT = 36;

type Props = {
  histogram: Histogram;
  // Bins outside of this range are greyed out.
  range?: ValueRange;
  isHighlighted?: boolean;
  // Marks single values within the distribution with a vertical line.
  markers?: Array<{ key: string; value: number; color: string }>;
  height?: number;
};

/*
 * A minimal bar histogram that shows how the values of a statistic are distributed.
 */
export function StatisticHistogram({
  histogram,
  range,
  isHighlighted = false,
  markers = [],
  height = DEFAULT_HEIGHT,
}: Props) {
  const { token } = theme.useToken();
  const { bins, min, max } = histogram;
  const maxCount = Math.max(1, ...bins);
  const binWidth = (max - min) / bins.length;
  return (
    <div style={{ position: "relative", height }} aria-hidden>
      <Flex align="flex-end" gap={1} style={{ height: "100%" }}>
        {bins.map((count, index) => {
          const binStart = min + index * binWidth;
          const binEnd = binStart + binWidth;
          const isInRange =
            range == null ||
            ((range[0] == null || binEnd >= range[0]) &&
              (range[1] == null || binStart <= range[1]));
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
      {markers.map((marker) => (
        <div
          key={marker.key}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 2,
            left: `${max > min ? Math.min(100, Math.max(0, ((marker.value - min) / (max - min)) * 100)) : 0}%`,
            background: marker.color,
          }}
        />
      ))}
    </div>
  );
}
