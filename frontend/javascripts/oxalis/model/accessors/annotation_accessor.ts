import _ from "lodash";
import type { OxalisState, Tracing } from "oxalis/store";
import { getVolumeTracingById } from "./volumetracing_accessor";
import { APIAnnotationInfo } from "types/api_flow_types";

export function mayEditAnnotationProperties(state: OxalisState) {
  const { owner, restrictions } = state.tracing;
  const activeUser = state.activeUser;

  return !!(
    restrictions.allowUpdate &&
    restrictions.allowSave &&
    activeUser &&
    owner?.id === activeUser.id
  );
}

export type SkeletonTracingStats = {
  treeCount: number;
  nodeCount: number;
  edgeCount: number;
  branchPointCount: number;
};

export type VolumeTracingStats = {
  segmentCount: number;
};

export type TracingStats = SkeletonTracingStats | VolumeTracingStats;
type TracingStatsHelper = {
  treeCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  branchPointCount?: number;
  segmentCount?: number;
};

// biome-ignore lint/complexity/noBannedTypes: {} should be avoided actually
export type CombinedTracingStats = (SkeletonTracingStats | {}) & (VolumeTracingStats | {});

export function getStats(
  tracing: Tracing,
  saveQueueType: "skeleton" | "volume" | "mapping",
  tracingId: string,
): TracingStats | null {
  switch (saveQueueType) {
    case "skeleton": {
      if (!tracing.skeleton) {
        return null;
      }
      const trees = tracing.skeleton.trees;
      return {
        treeCount: _.size(trees),
        nodeCount: _.reduce(trees, (sum, tree) => sum + tree.nodes.size(), 0),
        edgeCount: _.reduce(trees, (sum, tree) => sum + tree.edges.size(), 0),
        branchPointCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
      };
    }
    case "volume": {
      const volumeTracing = getVolumeTracingById(tracing, tracingId);
      return {
        segmentCount: volumeTracing.segments.size(),
      };
    }
    default:
      return null;
  }
}

export function getCombinedStats(tracing: Tracing): CombinedTracingStats {
  const aggregatedStats: TracingStatsHelper = {};

  if (tracing.skeleton) {
    const skeletonStats = getStats(tracing, "skeleton", tracing.skeleton.tracingId);
    if (skeletonStats && "treeCount" in skeletonStats) {
      const { treeCount, nodeCount, edgeCount, branchPointCount } = skeletonStats;
      aggregatedStats.treeCount = treeCount;
      aggregatedStats.nodeCount = nodeCount;
      aggregatedStats.edgeCount = edgeCount;
      aggregatedStats.branchPointCount = branchPointCount;
    }
  }

  for (const volumeTracing of tracing.volumes) {
    const volumeStats = getStats(tracing, "volume", volumeTracing.tracingId);
    if (volumeStats && "segmentCount" in volumeStats) {
      if (aggregatedStats.segmentCount == null) {
        aggregatedStats.segmentCount = 0;
      }
      aggregatedStats.segmentCount += volumeStats.segmentCount;
    }
  }

  return aggregatedStats;
}

export function getCombinedStatsFromServerAnnotation(
  annotation: APIAnnotationInfo,
): CombinedTracingStats {
  const aggregatedStats: TracingStatsHelper = {};

  for (const annotationLayer of annotation.annotationLayers) {
    const { stats } = annotationLayer;

    if ("treeCount" in stats) {
      const { treeCount, nodeCount, edgeCount, branchPointCount } = stats;
      aggregatedStats.treeCount = treeCount;
      aggregatedStats.nodeCount = nodeCount;
      aggregatedStats.edgeCount = edgeCount;
      aggregatedStats.branchPointCount = branchPointCount;
    } else if ("segmentCount" in stats) {
      if (aggregatedStats.segmentCount == null) {
        aggregatedStats.segmentCount = 0;
      }

      aggregatedStats.segmentCount += stats.segmentCount;
    }
  }

  return aggregatedStats;
}
