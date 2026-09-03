import type { Vector3 } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import {
  addLayerToAnnotation,
  addUserBoundingBoxInSkeletonTracing,
  addUserBoundingBoxInVolumeTracing,
  createSegmentVolumeAction,
  deleteAnnotationLayer,
  LEGACY_mergeTree,
  LEGACY_updateSegmentGroups,
  LEGACY_updateSegmentVolumeAction,
  LEGACY_updateUserBoundingBoxesInSkeletonTracing,
  LEGACY_updateUserBoundingBoxesInVolumeTracing,
  removeFallbackLayer,
  type ServerUpdateAction,
  serverCreateTracing,
  updateActiveNode,
  updateActiveSegmentId,
  updateSegmentGroupsExpandedState,
  updateSegmentGroupVisibilityVolumeAction,
  updateSegmentVisibilityVolumeAction,
  updateTreeGroupsExpandedState,
  updateTreeGroupVisibility,
  updateTreeVisibility,
  updateUserBoundingBoxVisibilityInSkeletonTracing,
  updateUserBoundingBoxVisibilityInVolumeTracing,
  upsertSegmentGroupUpdateAction,
} from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";

// -----------------------------------------------------------------------------------------------
// This module holds list of object used to build semantically similar update actions. They all
// create update actions. They are used by incorporate_update_actions.spec to test the
// tryToIncorporateActions saga. There is a list for each of such actions:
//   - all user specific skeleton update actions
//   - all user specific volume update actions
//   - all disallowed actions (mainly modifying the annotations layer set)
//   - all unsupported legacy actions
// -----------------------------------------------------------------------------------------------

export const REPLAYED_BOUNDING_BOX_ID = 12345;

// A fresh object per call -- several tests pass this through action creators that may hold onto or
// adapt the object, so a single shared literal reused across (differently-scoped) tests would risk
// one test's mutation/adaptation leaking into another's.
export function makeReplayedBoundingBox() {
  return {
    id: REPLAYED_BOUNDING_BOX_ID,
    name: "Replayed box",
    color: [1, 2, 3] as Vector3,
    isVisible: true,
    boundingBox: { min: [0, 0, 0] as Vector3, max: [1, 1, 1] as Vector3 },
  };
}

// Each case bundles an update action's own creation (setup/build) together with the assertion that
// proves whether it landed (wasApplied), so everything relevant to one action stays next to each
// other instead of being spread across a separate list of assertions.
export type GatedActionCase = {
  name: string;
  setup?: (tracingId: string) => ServerUpdateAction[];
  build: (tracingId: string) => ServerUpdateAction;
  wasApplied: (tracingId: string) => boolean;
};

export const allSkeletonUserSpecificActions: GatedActionCase[] = [
  {
    name: "updateActiveNode",
    build: (tracingId) =>
      updateActiveNode({ tracingId, activeNodeId: 2 }) as unknown as ServerUpdateAction,
    wasApplied: () => enforceSkeletonTracing(Store.getState().annotation).activeNodeId === 2,
  },
  {
    name: "updateTreeVisibility",
    build: (tracingId) => {
      const tree = enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(1);
      return updateTreeVisibility(
        { ...tree, isVisible: false },
        tracingId,
      ) as unknown as ServerUpdateAction;
    },
    wasApplied: () =>
      enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(1).isVisible === false,
  },
  {
    name: "updateTreeGroupVisibility",
    build: (tracingId) =>
      updateTreeGroupVisibility(null, false, tracingId) as unknown as ServerUpdateAction,
    wasApplied: () =>
      enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(1).isVisible === false,
  },
  {
    name: "updateUserBoundingBoxVisibilityInSkeletonTracing",
    setup: (tracingId) => [
      addUserBoundingBoxInSkeletonTracing(
        makeReplayedBoundingBox(),
        tracingId,
      ) as unknown as ServerUpdateAction,
    ],
    build: (tracingId) =>
      updateUserBoundingBoxVisibilityInSkeletonTracing(
        REPLAYED_BOUNDING_BOX_ID,
        false,
        tracingId,
      ) as unknown as ServerUpdateAction,
    wasApplied: () =>
      enforceSkeletonTracing(Store.getState().annotation).userBoundingBoxes.find(
        (bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID,
      )?.isVisible === false,
  },
  {
    name: "updateTreeGroupsExpandedState",
    build: (tracingId) =>
      updateTreeGroupsExpandedState([1], true, tracingId) as unknown as ServerUpdateAction,
    wasApplied: () =>
      enforceSkeletonTracing(Store.getState().annotation).treeGroups.find((g) => g.groupId === 1)
        ?.isExpanded === true,
  },
];

export const allVolumeUserSpecificActions: GatedActionCase[] = [
  {
    name: "updateActiveSegmentId",
    build: (tracingId) => updateActiveSegmentId(5n, tracingId) as unknown as ServerUpdateAction,
    wasApplied: (tracingId) =>
      getVolumeTracingById(Store.getState().annotation, tracingId).activeCellId === 5n,
  },
  {
    name: "updateSegmentVisibility",
    setup: (tracingId) => [
      createSegmentVolumeAction(
        999n,
        [1, 1, 1],
        [],
        "Seg999",
        null,
        null,
        [],
        tracingId,
      ) as unknown as ServerUpdateAction,
    ],
    build: (tracingId) =>
      updateSegmentVisibilityVolumeAction(999n, false, tracingId) as unknown as ServerUpdateAction,
    wasApplied: (tracingId) =>
      getVolumeTracingById(Store.getState().annotation, tracingId).segments.getOrThrow(999n)
        .isVisible === false,
  },
  {
    name: "updateSegmentGroupVisibility",
    setup: (tracingId) => [
      upsertSegmentGroupUpdateAction(
        1,
        { name: "Group A" },
        tracingId,
      ) as unknown as ServerUpdateAction,
      createSegmentVolumeAction(
        998n,
        [1, 1, 1],
        [],
        "Seg998",
        null,
        1,
        [],
        tracingId,
      ) as unknown as ServerUpdateAction,
    ],
    build: (tracingId) =>
      updateSegmentGroupVisibilityVolumeAction(
        1,
        false,
        tracingId,
      ) as unknown as ServerUpdateAction,
    wasApplied: (tracingId) =>
      getVolumeTracingById(Store.getState().annotation, tracingId).segments.getOrThrow(998n)
        .isVisible === false,
  },
  {
    name: "updateUserBoundingBoxVisibilityInVolumeTracing",
    // User bounding boxes are mirrored across all tracings in local state (see
    // updateUserBoundingBoxes in annotation_reducer.ts), so the real diffing sagas
    // (skeletontracing_saga.ts / volume_diffing.ts) each independently author their own
    // scoped add action for every local bbox change on a hybrid annotation -- both variants
    // always arrive together. Skipping the skeleton-scoped sibling here would leave the
    // skeleton tracing's mirrored list stale, and the visibility update below reads/rewrites
    // that list via maybeGetSomeTracing (which prefers skeleton when present).
    setup: (tracingId) => {
      const boundingBox = makeReplayedBoundingBox();
      const skeletonTracingId = enforceSkeletonTracing(Store.getState().annotation).tracingId;
      return [
        addUserBoundingBoxInSkeletonTracing(
          boundingBox,
          skeletonTracingId,
        ) as unknown as ServerUpdateAction,
        addUserBoundingBoxInVolumeTracing(boundingBox, tracingId) as unknown as ServerUpdateAction,
      ];
    },
    build: (tracingId) =>
      updateUserBoundingBoxVisibilityInVolumeTracing(
        REPLAYED_BOUNDING_BOX_ID,
        false,
        tracingId,
      ) as unknown as ServerUpdateAction,
    wasApplied: (tracingId) =>
      getVolumeTracingById(Store.getState().annotation, tracingId).userBoundingBoxes.find(
        (bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID,
      )?.isVisible === false,
  },
  {
    name: "updateSegmentGroupsExpandedState",
    setup: (tracingId) => [
      upsertSegmentGroupUpdateAction(
        1,
        { name: "Group A" },
        tracingId,
      ) as unknown as ServerUpdateAction,
    ],
    build: (tracingId) =>
      updateSegmentGroupsExpandedState([1], true, tracingId) as unknown as ServerUpdateAction,
    wasApplied: (tracingId) =>
      getVolumeTracingById(Store.getState().annotation, tracingId).segmentGroups.find(
        (g) => g.groupId === 1,
      )?.isExpanded === true,
  },
];

export const allDisallowedActions: Array<{
  name: string;
  build: (tracingId: string) => ServerUpdateAction;
}> = [
  {
    name: "addLayerToAnnotation",
    build: () =>
      addLayerToAnnotation({
        typ: "Volume",
        name: "New Layer",
      }) as unknown as ServerUpdateAction,
  },
  {
    name: "createTracing",
    build: () => serverCreateTracing(0) as unknown as ServerUpdateAction,
  },
  {
    name: "deleteLayerFromAnnotation",
    build: (tracingId) =>
      deleteAnnotationLayer(tracingId, "New Layer", "Volume") as unknown as ServerUpdateAction,
  },
  {
    name: "importVolumeTracing",
    build: () =>
      ({
        name: "importVolumeTracing" as const,
        value: { largestSegmentId: 42 },
      }) as unknown as ServerUpdateAction,
  },
  {
    name: "removeFallbackLayer",
    build: (tracingId) => removeFallbackLayer(tracingId) as unknown as ServerUpdateAction,
  },
];

export const allUnsupportedLegacyActions: Array<{ name: string; build: () => ServerUpdateAction }> =
  [
    {
      name: "mergeTree",
      build: () => {
        const { tracingId } = enforceSkeletonTracing(Store.getState().annotation);
        return LEGACY_mergeTree(1, 2, tracingId) as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateSegment",
      build: () => {
        const { tracingId } = Store.getState().annotation.volumes[0];
        return LEGACY_updateSegmentVolumeAction(
          1n,
          [1, 1, 1],
          [],
          "Seg",
          null,
          null,
          [],
          tracingId,
          0,
        ) as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateSkeletonTracing",
      build: () => {
        const { tracingId } = enforceSkeletonTracing(Store.getState().annotation);
        return {
          name: "updateSkeletonTracing" as const,
          value: {
            actionTracingId: tracingId,
            activeNode: null,
            editPosition: [0, 0, 0] as Vector3,
            editPositionAdditionalCoordinates: null,
            editRotation: [0, 0, 0] as Vector3,
            zoomLevel: 1,
          },
        } as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateVolumeTracing",
      build: () => {
        const { tracingId } = Store.getState().annotation.volumes[0];
        return {
          name: "updateVolumeTracing" as const,
          value: {
            actionTracingId: tracingId,
            activeSegmentId: null,
            editPosition: [0, 0, 0] as Vector3,
            editPositionAdditionalCoordinates: null,
            editRotation: [0, 0, 0] as Vector3,
            largestSegmentId: null,
            hideUnregisteredSegments: false,
            zoomLevel: 1,
          },
        } as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateUserBoundingBoxesInSkeletonTracing",
      build: () => {
        const { tracingId } = enforceSkeletonTracing(Store.getState().annotation);
        return LEGACY_updateUserBoundingBoxesInSkeletonTracing(
          [],
          tracingId,
        ) as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateSegmentGroups",
      build: () => {
        const { tracingId } = Store.getState().annotation.volumes[0];
        return LEGACY_updateSegmentGroups([], tracingId) as unknown as ServerUpdateAction;
      },
    },
    {
      name: "updateUserBoundingBoxesInVolumeTracing",
      build: () => {
        const { tracingId } = Store.getState().annotation.volumes[0];
        return LEGACY_updateUserBoundingBoxesInVolumeTracing(
          [],
          tracingId,
        ) as unknown as ServerUpdateAction;
      },
    },
  ];
