import Icon from "@ant-design/icons";
import IconBoundingBox from "@images/icons/icon-bounding-box.svg?react";
import IconSegments from "@images/icons/icon-segments.svg?react";
import IconSkeletons from "@images/icons/icon-skeletons.svg?react";
import type { EmptyObject } from "antd/es/_util/type";
import FastTooltip from "components/fast_tooltip";
import { formatNumber } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import memoizeOne from "memoize-one";
import type React from "react";
import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import {
  getSkeletonStats,
  getStats,
  getVolumeStats,
  type TracingStats,
} from "viewer/model/accessors/annotation_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";

type StatEntry = {
  key: string;
  icon: React.ComponentType;
  ariaLabel: string;
  tooltipHtml: string;
  count: number;
};

/**
 * Compact, icon-only statistics used outside of the info tab (dashboard tables, time
 * tracking). The info tab renders the same numbers as labelled rows instead, see
 * AnnotationStatisticsSection.
 */
export function AnnotationStats({
  stats,
  withMargin,
  boundingBoxCount,
  orientation = "vertical",
  hideZeroCounts = false,
}: {
  stats: TracingStats | EmptyObject;
  withMargin?: boolean | null | undefined;
  boundingBoxCount?: number;
  // "vertical" (default) stacks the stats as rows (e.g. in time tracking).
  // "horizontal" lays them out side by side (e.g. in the dashboard list views).
  orientation?: "vertical" | "horizontal";
  hideZeroCounts?: boolean;
}) {
  const skeletonStats = getSkeletonStats(stats);
  const volumeStats = getVolumeStats(stats);
  const totalSegmentCount = volumeStats.reduce((sum, [_, volume]) => sum + volume.segmentCount, 0);

  let entries: StatEntry[] = [];
  if (skeletonStats) {
    entries.push({
      key: "skeleton",
      icon: IconSkeletons,
      ariaLabel: "Skeletons",
      tooltipHtml: getSkeletonStatsTooltip(skeletonStats),
      count: skeletonStats.treeCount,
    });
  }
  if (volumeStats.length > 0) {
    entries.push({
      key: "volume",
      icon: IconSegments,
      ariaLabel: "Segments",
      tooltipHtml: getSegmentStatsTooltip(totalSegmentCount),
      count: totalSegmentCount,
    });
  }
  if (boundingBoxCount) {
    entries.push({
      key: "bbox",
      icon: IconBoundingBox,
      ariaLabel: "Bounding Boxes",
      tooltipHtml: getBoundingBoxStatsTooltip(boundingBoxCount),
      count: boundingBoxCount,
    });
  }

  if (hideZeroCounts) {
    entries = entries.filter((entry) => entry.count > 0);
  }
  if (entries.length === 0) return null;

  const useStyleWithMargin = withMargin != null ? withMargin : true;
  const styleWithLargeMarginBottom = { marginBottom: 14 };
  const styleWithSmallMargin = { margin: 2 };

  if (orientation === "horizontal") {
    return (
      <div
        className="info-tab-block annotation-stats-horizontal"
        style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
      >
        {entries.map((entry) => (
          <FastTooltip key={entry.key} placement="bottom" html={entry.tooltipHtml}>
            <Icon component={entry.icon} className="info-tab-icon" aria-label={entry.ariaLabel} />{" "}
            {formatNumber(entry.count)}
          </FastTooltip>
        ))}
      </div>
    );
  }

  return (
    <div
      className="info-tab-block"
      style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
    >
      <table className="annotation-stats-table-slim">
        <tbody>
          {entries.map((entry) => (
            <FastTooltip key={entry.key} placement="left" html={entry.tooltipHtml} wrapper="tr">
              <td>
                <Icon
                  component={entry.icon}
                  className="info-tab-icon"
                  aria-label={entry.ariaLabel}
                />
              </td>
              <td>{formatNumber(entry.count)}</td>
            </FastTooltip>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const getSkeletonStatsTooltip = (skeletonStats: NonNullable<ReturnType<typeof getSkeletonStats>>) =>
  `
    <p>Trees: ${formatNumber(skeletonStats.treeCount)}</p>
    <p>Nodes: ${formatNumber(skeletonStats.nodeCount)}</p>
    <p>Edges: ${formatNumber(skeletonStats.edgeCount)}</p>
    <p>Branchpoints: ${formatNumber(skeletonStats.branchPointCount)}</p>
  `;

const getSegmentStatsTooltip = (totalSegmentCount: number) =>
  `${formatNumber(totalSegmentCount)} – Only segments that were manually registered (either brushed or
   interacted with) are counted in this statistic. Segmentation layers created from automated
   workflows (also known as fallback layers) are not considered currently.`;

const getBoundingBoxStatsTooltip = (boundingBoxCount: number) =>
  `${formatNumber(boundingBoxCount)} – Only user-defined bounding boxes are counted in this statistic. Layer bounding boxes are excluded.`;

// getStats iterates over all trees which can be expensive for large tracings.
// memoizeOne avoids recomputing while the annotation is unchanged, and
// reuseInstanceOnEquality keeps the result instance stable when a mutation
// did not change any of the counts (to avoid unnecessary re-renders).
const cachedGetStats = reuseInstanceOnEquality(memoizeOne(getStats));

/** One fact per row — the counts are short values, so they share the capped value track. */
export function AnnotationStatisticsSection() {
  const stats = useWkSelector((state) => cachedGetStats(state.annotation));
  const boundingBoxCount = useWkSelector(
    (state) => maybeGetSomeTracing(state.annotation)?.userBoundingBoxes.length ?? 0,
  );

  const skeletonStats = getSkeletonStats(stats);
  const volumeStats = getVolumeStats(stats);
  const totalSegmentCount = volumeStats.reduce((sum, [_, volume]) => sum + volume.segmentCount, 0);

  return (
    <InfoTabSection label="Statistics">
      {skeletonStats ? (
        <>
          <InfoTabRow label="Trees" isShortValue>
            {formatNumber(skeletonStats.treeCount)}
          </InfoTabRow>
          {/* Shown inline rather than in a tooltip on the tree count — hover is hard to
              discover, and these three belong to the same fact. */}
          <div className="info-tab-subrows">
            <InfoTabRow label="Nodes" isShortValue>
              {formatNumber(skeletonStats.nodeCount)}
            </InfoTabRow>
            <InfoTabRow label="Edges" isShortValue>
              {formatNumber(skeletonStats.edgeCount)}
            </InfoTabRow>
            <InfoTabRow label="Branchpoints" isShortValue>
              {formatNumber(skeletonStats.branchPointCount)}
            </InfoTabRow>
          </div>
        </>
      ) : null}
      <InfoTabRow
        label="Segments"
        isShortValue
        tooltipHtml={getSegmentStatsTooltip(totalSegmentCount)}
      >
        {formatNumber(totalSegmentCount)}
      </InfoTabRow>
      <InfoTabRow
        label="Bounding boxes"
        isShortValue
        tooltipHtml={getBoundingBoxStatsTooltip(boundingBoxCount)}
      >
        {formatNumber(boundingBoxCount)}
      </InfoTabRow>
    </InfoTabSection>
  );
}
