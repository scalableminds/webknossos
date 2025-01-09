import _ from "lodash";
import type { OxalisState, Tracing } from "oxalis/store";
import type { EmptyObject } from "types/globals";
import { getVolumeTracingById } from "./volumetracing_accessor";

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

export function isAnnotationFromDifferentOrganization(state: OxalisState) {
  const activeUser = state.activeUser;

  return !!(activeUser && activeUser?.organization !== state.tracing.organization);
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

export type TracingStats = Record<string, SkeletonTracingStats | VolumeTracingStats | EmptyObject>;

export function getStats(tracing: Tracing): TracingStats {
  const stats: TracingStats = {};
  const { skeleton, volumes } = tracing;
  for (const volumeTracing of volumes) {
    stats[volumeTracing.tracingId] = { segmentCount: volumeTracing.segments.size() };
  }
  if (skeleton) {
    stats[skeleton.tracingId] = {
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

export function getSkeletonStats(stats: TracingStats): SkeletonTracingStats | undefined {
  for (const tracingId in stats) {
    if ("treeCount" in stats[tracingId]) {
      // TS thinks the return value could be EmptyObject even though
      // we just checked that treeCount is a property.
      return stats[tracingId] as SkeletonTracingStats;
    }
  }
  return undefined;
}

export function getVolumeStats(stats: TracingStats): [string, VolumeTracingStats][] {
  return Array.from(Object.entries(stats)).filter(
    ([_tracingId, stat]) => "segmentCount" in stat,
  ) as [string, VolumeTracingStats][];
}
