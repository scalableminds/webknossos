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
import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import {
  getSkeletonStats,
  getStats,
  getVolumeStats,
  type TracingStats,
} from "viewer/model/accessors/annotation_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";

export function AnnotationStats({
  stats,
  asInfoBlock,
  withMargin,
  boundingBoxCount,
}: {
  stats: TracingStats | EmptyObject;
  asInfoBlock: boolean;
  withMargin?: boolean | null | undefined;
  boundingBoxCount?: number;
}) {
  if ((!stats || Object.keys(stats).length === 0) && !boundingBoxCount) return null;
  const formatLabel = (str: string) => (asInfoBlock ? str : "");
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
      {asInfoBlock && <p className="sidebar-label">Statistics</p>}
      <table className={asInfoBlock ? "annotation-stats-table" : "annotation-stats-table-slim"}>
        <tbody>
          {skeletonStats ? (
            <FastTooltip
              placement="left"
              html={`
                  <p>Trees: ${formatNumber(skeletonStats.treeCount)}</p>
                  <p>Nodes: ${formatNumber(skeletonStats.nodeCount)}</p>
                  <p>Edges: ${formatNumber(skeletonStats.edgeCount)}</p>
                  <p>Branchpoints: ${formatNumber(skeletonStats.branchPointCount)}</p>
                `}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSkeletons} className="info-tab-icon" aria-label="Skeletons" />
              </td>
              <td>
                {formatNumber(skeletonStats.treeCount)}{" "}
                {formatLabel(pluralize("Tree", skeletonStats.treeCount))}
              </td>
            </FastTooltip>
          ) : null}
          {volumeStats.length > 0 ? (
            <FastTooltip
              placement="left"
              html={`${formatNumber(totalSegmentCount)} – Only segments that were manually registered (either brushed or
                      interacted with) are counted in this statistic. Segmentation layers
                      created from automated workflows (also known as fallback layers) are not
                      considered currently.`}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSegments} className="info-tab-icon" aria-label="Segments" />
              </td>
              <td>
                {formatNumber(totalSegmentCount)}{" "}
                {formatLabel(pluralize("Segment", totalSegmentCount))}
              </td>
            </FastTooltip>
          ) : null}
          {boundingBoxCount ? (
            <FastTooltip
              placement="left"
              html={`${formatNumber(boundingBoxCount)} – Only user-defined bounding boxes are counted in this statistic. Layer bounding boxes are excluded.`}
              wrapper="tr"
            >
              <td>
                <Icon
                  component={IconBoundingBox}
                  className="info-tab-icon"
                  aria-label="Bounding Boxes"
                />
              </td>
              <td>
                {formatNumber(boundingBoxCount)}{" "}
                {formatLabel(pluralize("Bounding Box", boundingBoxCount, "Bounding Boxes"))}
              </td>
            </FastTooltip>
          ) : null}
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
