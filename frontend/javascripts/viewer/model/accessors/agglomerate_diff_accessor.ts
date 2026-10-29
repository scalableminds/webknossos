import Constants from "viewer/constants";
import { TreeMap } from "viewer/model/types/tree_types";
import type {
  AgglomerateDiffDescriptor,
  AgglomerateDiffOverlay,
  SkeletonTracing,
  WebknossosState,
} from "viewer/store";

export function getAgglomerateKey(
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
): string {
  return JSON.stringify([layerName, mappingName, agglomerateId.toString()]);
}

export function getAgglomerateDiffKey(descriptor: AgglomerateDiffDescriptor): string {
  return JSON.stringify([
    descriptor.layerName,
    descriptor.mappingName,
    descriptor.agglomerateId.toString(),
    descriptor.referenceMappingName,
  ]);
}

export function getAgglomerateDiffOverlay(state: WebknossosState): AgglomerateDiffOverlay {
  return state.localSkeletonState.agglomerateDiffOverlay;
}

export function getAgglomerateDiffSkeleton(state: WebknossosState): SkeletonTracing {
  return getAgglomerateDiffOverlay(state).skeleton;
}

export function hasVisibleAgglomerateDiffs(state: WebknossosState): boolean {
  const overlay = getAgglomerateDiffOverlay(state);
  return overlay.isVisible && overlay.skeleton.trees.size() > 0;
}

export function createEmptyAgglomerateDiffOverlay(): AgglomerateDiffOverlay {
  return {
    diffs: {},
    segmentIdByAgglomerate: {},
    isVisible: true,
    skeleton: {
      createdTimestamp: Date.now(),
      type: "skeleton",
      activeNodeId: null,
      cachedMaxNodeId: Constants.MIN_NODE_ID - 1,
      agglomerateDiffReferences: [],
      trees: new TreeMap(),
      treeGroups: [],
      tracingId: "agglomerate-diff-overlay",
      boundingBox: null,
      userBoundingBoxes: [],
      additionalAxes: [],
    },
  };
}
