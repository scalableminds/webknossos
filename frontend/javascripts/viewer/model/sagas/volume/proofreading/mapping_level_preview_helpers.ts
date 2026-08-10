import Constants from "viewer/constants";
import { TreeMap } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";

// Shared tracingId for the ephemeral mapping-level preview skeleton. Kept stable across previews so that skeleton
// updates flow through Skeleton.refresh (diff-based) rather than a full reset. See SPIKE-per-agglomerate-mapping-level.md.
export const MAPPING_LEVEL_PREVIEW_TRACING_ID = "mapping-level-preview";

// Wraps preview trees into an ephemeral store SkeletonTracing (kept separate from annotation.skeleton).
export function buildMappingLevelPreviewSkeleton(trees: SkeletonTracing["trees"]): SkeletonTracing {
  return {
    createdTimestamp: Date.now(),
    type: "skeleton",
    activeNodeId: null,
    cachedMaxNodeId: Constants.MIN_NODE_ID - 1,
    activeTreeId: null,
    activeGroupId: null,
    trees,
    treeGroups: [],
    tracingId: MAPPING_LEVEL_PREVIEW_TRACING_ID,
    boundingBox: null,
    userBoundingBoxes: [],
    navigationList: { list: [], activeIndex: -1 },
    showSkeletons: true,
    additionalAxes: [],
  };
}

// An empty preview skeleton. Seeded before the three.js Skeleton is registered so its buffers are initialized
// (the Skeleton class does not support a null tracing and crashes on the first render otherwise).
export function buildEmptyMappingLevelPreviewSkeleton(): SkeletonTracing {
  return buildMappingLevelPreviewSkeleton(new TreeMap());
}
