import _ from "lodash";
import type {
  APIAnnotationUserState,
  APIUserBase,
  SkeletonUserState,
  VolumeUserState,
} from "types/api_types";
import type { EmptyObject } from "types/globals";
import type { StoreAnnotation, WebknossosState } from "viewer/store";
import { sum } from "../helpers/iterator_utils";

export function mayEditAnnotationProperties(state: WebknossosState) {
  const { owner, restrictions, isUpdatingCurrentlyAllowed } = state.annotation;
  const activeUser = state.activeUser;

  return !!(
    isUpdatingCurrentlyAllowed &&
    restrictions.allowUpdate &&
    restrictions.allowSave &&
    activeUser &&
    owner?.id === activeUser.id &&
    !state.annotation.isLockedByOwner
  );
}

export function isAnnotationOwner(state: WebknossosState) {
  const activeUser = state.activeUser;
  const owner = state.annotation.owner;

  return !!(activeUser && owner?.id === activeUser.id);
}

export function isAnnotationFromDifferentOrganization(state: WebknossosState) {
  const activeUser = state.activeUser;

  return !!(activeUser && activeUser?.organization !== state.annotation.organization);
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

export function getStats(annotation: StoreAnnotation): TracingStats {
  const stats: TracingStats = {};
  const { skeleton, volumes } = annotation;
  for (const volumeTracing of volumes) {
    stats[volumeTracing.tracingId] = { segmentCount: volumeTracing.segments.size() };
  }
  if (skeleton) {
    stats[skeleton.tracingId] = {
      treeCount: skeleton.trees.size(),
      nodeCount: sum(skeleton.trees.values().map((tree) => tree.nodes.size())),
      edgeCount: sum(skeleton.trees.values().map((tree) => tree.edges.size())),
      branchPointCount: sum(skeleton.trees.values().map((tree) => _.size(tree.branchPoints))),
    };
  }
  return stats;
}

export function getCreationTimestamp(annotation: StoreAnnotation) {
  let timestamp = annotation.skeleton?.createdTimestamp;
  for (const volumeTracing of annotation.volumes) {
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
  return Object.entries(stats).filter(([_tracingId, stat]) => "segmentCount" in stat) as [
    string,
    VolumeTracingStats,
  ][];
}

export function getUserStateForTracing<
  T extends APIAnnotationUserState | VolumeUserState | SkeletonUserState,
>(
  tracing: { userStates: T[] },
  activeUser: APIUserBase | null | undefined,
  owner: APIUserBase | null | undefined,
): T | undefined {
  let userState: T | undefined;
  if (activeUser) {
    userState = tracing.userStates.find((state) => state.userId === activeUser.id);
    if (userState) {
      return userState;
    }
  }

  if (owner) {
    userState = tracing.userStates.find((state) => state.userId === owner.id);
    if (userState) {
      return userState;
    }
  }

  return undefined;
}
