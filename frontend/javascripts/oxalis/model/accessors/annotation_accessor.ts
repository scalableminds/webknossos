import _ from "lodash";
import type { OxalisState, Tracing } from "oxalis/store";
import type { APIAnnotationInfo } from "types/api_flow_types";
import type { EmptyObject } from "types/globals";

export function mayEditAnnotationProperties(state: OxalisState) {
  const { owner, restrictions } = state.tracing;
  const activeUser = state.activeUser;

  return !!(
    restrictions.allowUpdate &&
    restrictions.allowSave &&
    activeUser &&
    owner?.id === activeUser.id &&
    !state.tracing.isLockedByOwner
  );
}

export function isAnnotationOwner(state: OxalisState) {
  const activeUser = state.activeUser;
  const owner = state.tracing.owner;

  return !!(activeUser && owner?.id === activeUser.id);
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

export function getStats(tracing: Tracing): CombinedTracingStats {
  const { skeleton, volumes } = tracing;
  let totalSegmentCount = 0;
  for (const volumeTracing of volumes) {
    // TODOM: Update annotation stats according to the JSON and always send all layers
    totalSegmentCount += volumeTracing.segments.size();
  }
  let stats: TracingStats = {
    segmentCount: totalSegmentCount,
  };
  if (skeleton) {
    stats = {
      ...stats,
      treeCount: _.size(skeleton.trees),
      nodeCount: _.reduce(skeleton.trees, (sum, tree) => sum + tree.nodes.size(), 0),
      edgeCount: _.reduce(skeleton.trees, (sum, tree) => sum + tree.edges.size(), 0),
      branchPointCount: _.reduce(skeleton.trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
    };
  }
  return stats;
}

export function getCreationTimestamp(tracing: Tracing) {
  let timestamp = tracing.skeleton?.createdTimestamp;
  for (const volumeTracing of tracing.volumes) {
    if (!timestamp || volumeTracing.createdTimestamp < timestamp) {
      timestamp = volumeTracing.createdTimestamp;
    }
  }
  return timestamp || 0;
}

export function getCombinedStatsFromServerAnnotation(
  annotation: APIAnnotationInfo,
): CombinedTracingStats {
  return aggregateStatsForAllLayers(
    annotation.annotationLayers.map((annotation) => annotation.stats),
  );
}

export function aggregateStatsForAllLayers(
  stats: Array<TracingStats | EmptyObject>,
): CombinedTracingStats {
  const aggregatedStats: TracingStatsHelper = {};

  for (const annotationLayerStats of stats) {
    if ("treeCount" in annotationLayerStats) {
      const { treeCount, nodeCount, edgeCount, branchPointCount } = annotationLayerStats;
      aggregatedStats.treeCount = treeCount;
      aggregatedStats.nodeCount = nodeCount;
      aggregatedStats.edgeCount = edgeCount;
      aggregatedStats.branchPointCount = branchPointCount;
    } else if ("segmentCount" in annotationLayerStats) {
      if (aggregatedStats.segmentCount == null) {
        aggregatedStats.segmentCount = 0;
      }

      aggregatedStats.segmentCount += annotationLayerStats.segmentCount;
    }
  }

  return aggregatedStats;
}
