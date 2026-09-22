import Icon from "@ant-design/icons";
import IconBoundingBox from "@images/icons/icon-bounding-box.svg?react";
import IconSegments from "@images/icons/icon-segments.svg?react";
import IconSkeletons from "@images/icons/icon-skeletons.svg?react";
import type { EmptyObject } from "antd/es/_util/type";
import FastTooltip from "components/fast_tooltip";
import { formatNumber } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import memoizeOne from "memoize-one";
import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import {
  getSkeletonStats,
  getStats,
  getVolumeStats,
  type TracingStats,
} from "viewer/model/accessors/annotation_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";

/**
 * Compact, icon-only statistics used outside of the info tab (dashboard tables, time
 * tracking). The info tab renders the same numbers as labelled rows instead, see
 * AnnotationStatisticsSection.
 */
export function AnnotationStats({
  stats,
  withMargin,
  boundingBoxCount,
}: {
  stats: TracingStats | EmptyObject;
  withMargin?: boolean | null | undefined;
  boundingBoxCount?: number;
}) {
  if ((!stats || Object.keys(stats).length === 0) && !boundingBoxCount) return null;
  const useStyleWithMargin = withMargin != null ? withMargin : true;
  const styleWithLargeMarginBottom = { marginBottom: 14 };
  const styleWithSmallMargin = { margin: 2 };
  const skeletonStats = getSkeletonStats(stats);
  const volumeStats = getVolumeStats(stats);
  const totalSegmentCount = volumeStats.reduce((sum, [_, volume]) => sum + volume.segmentCount, 0);

  return (
    <div
      className="info-tab-block"
      style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
    >
      <table className="annotation-stats-table-slim">
        <tbody>
          {skeletonStats ? (
            <FastTooltip
              placement="left"
              html={getSkeletonStatsTooltip(skeletonStats)}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSkeletons} className="info-tab-icon" aria-label="Skeletons" />
              </td>
              <td>{formatNumber(skeletonStats.treeCount)}</td>
            </FastTooltip>
          ) : null}
          {volumeStats.length > 0 ? (
            <FastTooltip
              placement="left"
              html={getSegmentStatsTooltip(totalSegmentCount)}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSegments} className="info-tab-icon" aria-label="Segments" />
              </td>
              <td>{formatNumber(totalSegmentCount)}</td>
            </FastTooltip>
          ) : null}
          {boundingBoxCount ? (
            <FastTooltip
              placement="left"
              html={getBoundingBoxStatsTooltip(boundingBoxCount)}
              wrapper="tr"
            >
              <td>
                <Icon
                  component={IconBoundingBox}
                  className="info-tab-icon"
                  aria-label="Bounding Boxes"
                />
              </td>
              <td>{formatNumber(boundingBoxCount)}</td>
            </FastTooltip>
          ) : null}
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
        <InfoTabRow label="Trees" isShortValue tooltipHtml={getSkeletonStatsTooltip(skeletonStats)}>
          {formatNumber(skeletonStats.treeCount)}
        </InfoTabRow>
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
