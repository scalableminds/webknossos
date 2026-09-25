import Icon from "@ant-design/icons";
import IconBoundingBox from "@images/icons/icon-bounding-box.svg?react";
import IconSegments from "@images/icons/icon-segments.svg?react";
import IconSkeletons from "@images/icons/icon-skeletons.svg?react";
import type { EmptyObject } from "antd/es/_util/type";
import FastTooltip from "components/fast_tooltip";
import { formatNumber } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
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

type StatEntry = {
  key: string;
  icon: React.ComponentType;
  ariaLabel: string;
  tooltipHtml: string;
  count: number;
  label: string;
};

export function AnnotationStats({
  stats,
  asInfoBlock,
  withMargin,
  boundingBoxCount,
  orientation = "vertical",
}: {
  stats: TracingStats | EmptyObject;
  asInfoBlock: boolean;
  withMargin?: boolean | null | undefined;
  boundingBoxCount?: number;
  // "vertical" (default) stacks the stats as rows (e.g. in the info tab sidebar).
  // "horizontal" lays them out side by side (e.g. in the dashboard list views).
  orientation?: "vertical" | "horizontal";
}) {
  const formatLabel = (str: string) => (asInfoBlock ? str : "");
  const skeletonStats = getSkeletonStats(stats);
  const volumeStats = getVolumeStats(stats);
  const totalSegmentCount = volumeStats.reduce((sum, [_, volume]) => sum + volume.segmentCount, 0);

  const entries: StatEntry[] = [];
  if (skeletonStats) {
    entries.push({
      key: "skeleton",
      icon: IconSkeletons,
      ariaLabel: "Skeletons",
      tooltipHtml: `
          <p>Trees: ${formatNumber(skeletonStats.treeCount)}</p>
          <p>Nodes: ${formatNumber(skeletonStats.nodeCount)}</p>
          <p>Edges: ${formatNumber(skeletonStats.edgeCount)}</p>
          <p>Branchpoints: ${formatNumber(skeletonStats.branchPointCount)}</p>
        `,
      count: skeletonStats.treeCount,
      label: pluralize("Tree", skeletonStats.treeCount),
    });
  }
  if (volumeStats.length > 0) {
    entries.push({
      key: "volume",
      icon: IconSegments,
      ariaLabel: "Segments",
      tooltipHtml: `${formatNumber(totalSegmentCount)} – Only segments that were manually registered (either brushed or
              interacted with) are counted in this statistic. Segmentation layers
              created from automated workflows (also known as fallback layers) are not
              considered currently.`,
      count: totalSegmentCount,
      label: pluralize("Segment", totalSegmentCount),
    });
  }
  if (boundingBoxCount) {
    entries.push({
      key: "bbox",
      icon: IconBoundingBox,
      ariaLabel: "Bounding Boxes",
      tooltipHtml: `${formatNumber(boundingBoxCount)} – Only user-defined bounding boxes are counted in this statistic. Layer bounding boxes are excluded.`,
      count: boundingBoxCount,
      label: pluralize("Bounding Box", boundingBoxCount, "Bounding Boxes"),
    });
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
        {asInfoBlock && <p className="sidebar-label">Statistics</p>}
        {entries.map((entry) => (
          <FastTooltip key={entry.key} placement="bottom" html={entry.tooltipHtml}>
            <Icon component={entry.icon} className="info-tab-icon" aria-label={entry.ariaLabel} />{" "}
            {formatNumber(entry.count)} {formatLabel(entry.label)}
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
      {asInfoBlock && <p className="sidebar-label">Statistics</p>}
      <table className={asInfoBlock ? "annotation-stats-table" : "annotation-stats-table-slim"}>
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
              <td>
                {formatNumber(entry.count)} {formatLabel(entry.label)}
              </td>
            </FastTooltip>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// getStats iterates over all trees which can be expensive for large tracings.
// memoizeOne avoids recomputing while the annotation is unchanged, and
// reuseInstanceOnEquality keeps the result instance stable when a mutation
// did not change any of the counts (to avoid unnecessary re-renders).
const cachedGetStats = reuseInstanceOnEquality(memoizeOne(getStats));

export function AnnotationStatisticsSection() {
  const stats = useWkSelector((state) => cachedGetStats(state.annotation));
  const boundingBoxCount = useWkSelector(
    (state) => maybeGetSomeTracing(state.annotation)?.userBoundingBoxes.length ?? 0,
  );
  return <AnnotationStats stats={stats} asInfoBlock boundingBoxCount={boundingBoxCount} />;
}
