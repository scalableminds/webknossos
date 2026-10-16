import Toast from "libs/toast";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import {
  expectedMappingAfterMerge,
  initialMapping,
} from "test/sagas/proofreading/proofreading_fixtures";
import {
  expectMapping,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  mockInitialBucketAndAgglomerateData,
} from "test/sagas/proofreading/proofreading_test_utils";
import {
  allDisallowedActions,
  allSkeletonUserSpecificActions,
  allUnsupportedLegacyActions,
  allVolumeUserSpecificActions,
  makeReplayedBoundingBox,
  REPLAYED_BOUNDING_BOX_ID,
} from "test/sagas/saving/rebasing/incorporate_update_actions_fixtures";
import { call } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import { editAnnotationLayerAction } from "viewer/model/actions/annotation_actions";
import {
  discardSaveQueueAction,
  finishForwardingUpdateActionsAction,
  startForwardingUpdateActionsAction,
} from "viewer/model/actions/save_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import type { ApplyingUpdateResults } from "viewer/model/sagas/saving/rebasing/applying_update_artifacts";
import { tryToIncorporateActions } from "viewer/model/sagas/saving/rebasing/incorporate_update_actions_sagas";
import {
  addBookmark,
  addUserBoundingBoxInSkeletonTracing,
  addUserBoundingBoxInVolumeTracing,
  createEdge,
  createNode,
  createSegmentVolumeAction,
  createTree,
  deleteEdge,
  deleteNode,
  deleteSegmentGroupUpdateAction,
  deleteSegmentVolumeAction,
  deleteTree,
  deleteUserBoundingBoxInSkeletonTracing,
  deleteUserBoundingBoxInVolumeTracing,
  mergeAgglomerate,
  mergeSegmentItemsVolumeAction,
  moveTreeComponent,
  revertToVersion,
  type ServerUpdateAction,
  splitAgglomerate,
  updateAnnotationLayerName,
  updateLargestSegmentId,
  updateMappingName,
  updateMetadataOfAnnotation,
  updateMetadataOfSegmentUpdateAction,
  updateNode,
  updateSegmentPartialVolumeAction,
  updateTree,
  updateTreeEdgesVisibility,
  updateTreeGroups,
  updateUserBoundingBoxInSkeletonTracing,
  updateUserBoundingBoxInVolumeTracing,
  updateVolumeBucketDataHasChanged,
  upsertSegmentGroupUpdateAction,
} from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TypeScript enforces (via ServerUpdateAction["name"]) that every update-action type is listed
// here -- the same guarantee incorporate_update_actions_sagas.tsx's own `action satisfies never`
// gives the source file. seenActionTypes is populated at runtime (see incorporateActionsEffect
// below); the final "covers every update action" test asserts nothing was declared here without
// actually being exercised.
const actionNamesHelper: Record<ServerUpdateAction["name"], true> = {
  updateCamera: true,
  updateTdCamera: true,
  updateActiveNode: true,
  updateTreeVisibility: true,
  updateTreeGroupVisibility: true,
  updateUserBoundingBoxVisibilityInSkeletonTracing: true,
  updateTreeGroupsExpandedState: true,
  updateActiveSegmentId: true,
  updateSegmentVisibility: true,
  updateSegmentGroupVisibility: true,
  updateUserBoundingBoxVisibilityInVolumeTracing: true,
  updateSegmentGroupsExpandedState: true,
  createTree: true,
  updateTree: true,
  createNode: true,
  createEdge: true,
  updateNode: true,
  moveTreeComponent: true,
  deleteTree: true,
  deleteEdge: true,
  deleteNode: true,
  updateTreeEdgesVisibility: true,
  updateTreeGroups: true,
  addUserBoundingBoxInSkeletonTracing: true,
  updateUserBoundingBoxInSkeletonTracing: true,
  deleteUserBoundingBoxInSkeletonTracing: true,
  updateLargestSegmentId: true,
  updateVolumeBucketDataHasChanged: true,
  createSegment: true,
  mergeSegmentItems: true,
  deleteSegment: true,
  updateSegmentPartial: true,
  updateMetadataOfSegment: true,
  upsertSegmentGroup: true,
  deleteSegmentGroup: true,
  addUserBoundingBoxInVolumeTracing: true,
  deleteUserBoundingBoxInVolumeTracing: true,
  updateUserBoundingBoxInVolumeTracing: true,
  updateBucket: true,
  deleteSegmentData: true,
  mergeAgglomerate: true,
  splitAgglomerate: true,
  updateMappingName: true,
  updateLayerMetadata: true,
  updateMetadataOfAnnotation: true,
  addBookmark: true,
  addSegmentIndex: true,
  revertToVersion: true,
  addLayerToAnnotation: true,
  createTracing: true,
  deleteLayerFromAnnotation: true,
  importVolumeTracing: true,
  removeFallbackLayer: true,
  mergeTree: true,
  updateSegment: true,
  updateSkeletonTracing: true,
  updateVolumeTracing: true,
  updateUserBoundingBoxesInSkeletonTracing: true,
  updateSegmentGroups: true,
  updateUserBoundingBoxesInVolumeTracing: true,
};
const actionNamesList = Object.keys(actionNamesHelper);
const seenActionTypes = new Set<string>();

type IncorporatableUpdateAction = { name: string; value: object };

// Builds the single-batch payload tryToIncorporateActions expects (adding the actionTimestamp
// every server-shaped action needs) and records every incorporated action's name in
// seenActionTypes -- so the "covers every update action type" check at the bottom stays accurate
// on its own, without a parallel, easy-to-forget seenActionTypes.add(...) next to every
// incorporation call below. Yield this with `yield*` from within an existing saga that needs extra
// setup steps first (see the bucket/proofreading tests); incorporateActions below wraps it in its
// own saga for the common case of "just incorporate these actions".
function* incorporateActionsEffect(
  actions: IncorporatableUpdateAction[],
  version: number,
  areUnsavedChangesOfUser = false,
) {
  const timestampedActions = actions.map(
    (a) => ({ ...a, value: { ...a.value, actionTimestamp: 0 } }) as unknown as ServerUpdateAction,
  );
  const result: ApplyingUpdateResults | undefined = yield tryToIncorporateActions(
    [{ version, value: timestampedActions }],
    areUnsavedChangesOfUser,
  );
  for (const action of actions) {
    seenActionTypes.add(action.name);
  }
  return result;
}

async function incorporateActions(
  actions: IncorporatableUpdateAction[],
  version: number,
  areUnsavedChangesOfUser = false,
): Promise<ApplyingUpdateResults | undefined> {
  let result: ApplyingUpdateResults | undefined;
  const task = startSaga(function* () {
    result = yield* incorporateActionsEffect(actions, version, areUnsavedChangesOfUser);
  });
  await task.toPromise();
  return result;
}

describe("tryToIncorporateActions (rebase/forwarding incorporation)", () => {
  describe("No-op actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it("ignores updateCamera / updateTdCamera and still bumps the version", async () => {
      const versionBefore = Store.getState().annotation.version;

      await incorporateActions(
        [
          {
            name: "updateCamera" as const,
            value: {
              editPosition: [0, 0, 0] as Vector3,
              editPositionAdditionalCoordinates: null,
              editRotation: [0, 0, 0] as Vector3,
              zoomLevel: 1,
            },
          },
          { name: "updateTdCamera" as const, value: {} },
        ],
        versionBefore + 1,
      );

      expect(Store.getState().annotation.version).toBe(versionBefore + 1);
    });
  });

  describe("User-specific actions are only applied when replaying the current user's own actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    for (const { name, setup, build, wasApplied } of allSkeletonUserSpecificActions) {
      it.each([true, false])(
        `only applies skeleton action "${name}" to local state when areUnsavedChangesOfUser=%s`,
        async (areUnsavedChangesOfUser) => {
          const { tracingId } = enforceSkeletonTracing(Store.getState().annotation);
          if (setup) {
            await incorporateActions(setup(tracingId), 1, false);
          }

          await incorporateActions([build(tracingId)], 1, areUnsavedChangesOfUser);

          expect(wasApplied(tracingId)).toBe(areUnsavedChangesOfUser);
        },
      );
    }

    for (const { name, setup, build, wasApplied } of allVolumeUserSpecificActions) {
      it.each([true, false])(
        `only applies volume action "${name}" to local state when areUnsavedChangesOfUser=%s`,
        async (areUnsavedChangesOfUser) => {
          const { tracingId } = Store.getState().annotation.volumes[0];
          if (setup) {
            await incorporateActions(setup(tracingId), 1, false);
          }

          await incorporateActions([build(tracingId)], 1, areUnsavedChangesOfUser);

          expect(wasApplied(tracingId)).toBe(areUnsavedChangesOfUser);
        },
      );
    }
  });

  describe("Always-applied skeleton actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it("correctly forwards a chained sequence of tree/node/edge/bounding-box actions", async () => {
      const { tracingId } = enforceSkeletonTracing(Store.getState().annotation);
      const existingTree = enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(1);
      const existingNode = existingTree.nodes.getOrThrow(1);

      const newTree = { ...existingTree, treeId: 3, name: "Incorporated Tree" };
      const nodeA = { ...existingNode, id: 10 };
      const nodeB = { ...existingNode, id: 11 };

      // createTree, createNode x2, createEdge: build a small new tree.
      await incorporateActions(
        [
          createTree(newTree, tracingId),
          createNode(newTree.treeId, nodeA, tracingId),
          createNode(newTree.treeId, nodeB, tracingId),
          createEdge(newTree.treeId, nodeA.id, nodeB.id, tracingId),
        ],
        1,
      );

      let skeleton = enforceSkeletonTracing(Store.getState().annotation);
      expect(skeleton.trees.has(newTree.treeId)).toBe(true);
      expect(skeleton.trees.getOrThrow(newTree.treeId).nodes.has(nodeA.id)).toBe(true);
      expect(skeleton.trees.getOrThrow(newTree.treeId).nodes.has(nodeB.id)).toBe(true);
      expect(skeleton.trees.getOrThrow(newTree.treeId).edges.getEdgesForNode(nodeA.id)).toEqual([
        { source: nodeA.id, target: nodeB.id },
      ]);

      // updateTree, updateNode, updateTreeEdgesVisibility, updateTreeGroups.
      const newTreeGroup = { children: [], name: "New Group", groupId: 4 };
      await incorporateActions(
        [
          updateTree({ ...newTree, name: "Renamed Tree" }, tracingId),
          updateNode(newTree.treeId, { ...nodeA, radius: 42 }, tracingId),
          updateTreeEdgesVisibility({ ...newTree, edgesAreVisible: false }, tracingId),
          updateTreeGroups([...skeleton.treeGroups, newTreeGroup], tracingId),
        ],
        2,
      );

      skeleton = enforceSkeletonTracing(Store.getState().annotation);
      expect(skeleton.trees.getOrThrow(newTree.treeId).name).toBe("Renamed Tree");
      expect(skeleton.trees.getOrThrow(newTree.treeId).nodes.getOrThrow(nodeA.id).radius).toBe(42);
      expect(skeleton.trees.getOrThrow(newTree.treeId).edgesAreVisible).toBe(false);
      expect(skeleton.treeGroups.some((g) => g.groupId === newTreeGroup.groupId)).toBe(true);

      // moveTreeComponent (move both nodes into the existing tree), deleteEdge, deleteNode, deleteTree.
      await incorporateActions(
        [
          moveTreeComponent(newTree.treeId, existingTree.treeId, [nodeA.id, nodeB.id], tracingId),
          deleteEdge(existingTree.treeId, nodeA.id, nodeB.id, tracingId),
          deleteNode(existingTree.treeId, nodeB.id, tracingId),
          deleteTree(newTree.treeId, tracingId),
        ],
        3,
      );

      skeleton = enforceSkeletonTracing(Store.getState().annotation);
      expect(skeleton.trees.has(newTree.treeId)).toBe(false);
      expect(skeleton.trees.getOrThrow(existingTree.treeId).nodes.has(nodeA.id)).toBe(true);
      expect(skeleton.trees.getOrThrow(existingTree.treeId).nodes.has(nodeB.id)).toBe(false);

      // Skeleton user bounding boxes: add, update, delete.
      await incorporateActions(
        [addUserBoundingBoxInSkeletonTracing(makeReplayedBoundingBox(), tracingId)],
        4,
      );
      expect(
        enforceSkeletonTracing(Store.getState().annotation).userBoundingBoxes.some(
          (bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID,
        ),
      ).toBe(true);

      await incorporateActions(
        [
          updateUserBoundingBoxInSkeletonTracing(
            REPLAYED_BOUNDING_BOX_ID,
            { name: "Renamed box" },
            tracingId,
          ),
        ],
        5,
      );
      expect(
        enforceSkeletonTracing(Store.getState().annotation).userBoundingBoxes.find(
          (bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID,
        )?.name,
      ).toBe("Renamed box");

      await incorporateActions(
        [deleteUserBoundingBoxInSkeletonTracing(REPLAYED_BOUNDING_BOX_ID, tracingId)],
        6,
      );
      expect(
        enforceSkeletonTracing(Store.getState().annotation).userBoundingBoxes.some(
          (bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID,
        ),
      ).toBe(false);
    });
  });

  describe("Always-applied volume actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it("correctly forwards a chained sequence of segment/group/bounding-box actions", async () => {
      const { tracingId } = Store.getState().annotation.volumes[0];
      const getVolume = () => getVolumeTracingById(Store.getState().annotation, tracingId);

      const segmentA = { id: 100n, name: "Seg100" };
      const segmentB = { id: 101n, name: "Seg101" };

      await incorporateActions(
        [
          createSegmentVolumeAction(
            segmentA.id,
            [1, 1, 1],
            [],
            segmentA.name,
            [1, 2, 3],
            null,
            [],
            tracingId,
          ),
          createSegmentVolumeAction(
            segmentB.id,
            [2, 2, 2],
            [],
            segmentB.name,
            [4, 5, 6],
            null,
            [],
            tracingId,
          ),
        ],
        1,
      );
      expect(getVolume().segments.has(segmentA.id)).toBe(true);
      expect(getVolume().segments.has(segmentB.id)).toBe(true);

      const segmentGroup = { groupId: 1, name: "Group A" };
      await incorporateActions(
        [
          updateSegmentPartialVolumeAction({ id: segmentA.id, name: "Renamed100" }, tracingId),
          updateMetadataOfSegmentUpdateAction(
            segmentA.id,
            [{ key: "foo", stringValue: "bar" }],
            [],
            tracingId,
          ),
          upsertSegmentGroupUpdateAction(
            segmentGroup.groupId,
            { name: segmentGroup.name },
            tracingId,
          ),
        ],
        2,
      );
      expect(getVolume().segments.getOrThrow(segmentA.id).name).toBe("Renamed100");
      expect(getVolume().segments.getOrThrow(segmentA.id).metadata).toEqual([
        { key: "foo", stringValue: "bar" },
      ]);
      expect(
        getVolume().segmentGroups.some(
          (g) => g.groupId === segmentGroup.groupId && g.name === segmentGroup.name,
        ),
      ).toBe(true);

      await incorporateActions(
        [
          mergeSegmentItemsVolumeAction(
            segmentA.id,
            segmentB.id,
            segmentA.id,
            segmentB.id,
            tracingId,
          ),
        ],
        3,
      );
      expect(getVolume().segments.has(segmentB.id)).toBe(false);

      await incorporateActions(
        [
          deleteSegmentVolumeAction(segmentA.id, tracingId),
          deleteSegmentGroupUpdateAction(segmentGroup.groupId, tracingId),
          updateLargestSegmentId(500n, tracingId),
          updateVolumeBucketDataHasChanged(true, tracingId),
        ],
        4,
      );
      expect(getVolume().segments.has(segmentA.id)).toBe(false);
      expect(getVolume().segmentGroups.some((g) => g.groupId === segmentGroup.groupId)).toBe(false);
      expect(getVolume().largestSegmentId).toBe(500n);
      expect(getVolume().volumeBucketDataHasChanged).toBe(true);

      // Volume user bounding boxes: add, update, delete.
      await incorporateActions(
        [addUserBoundingBoxInVolumeTracing(makeReplayedBoundingBox(), tracingId)],
        5,
      );
      expect(
        getVolume().userBoundingBoxes.some((bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID),
      ).toBe(true);

      await incorporateActions(
        [
          updateUserBoundingBoxInVolumeTracing(
            REPLAYED_BOUNDING_BOX_ID,
            { name: "Renamed volume box" },
            tracingId,
          ),
        ],
        6,
      );
      expect(
        getVolume().userBoundingBoxes.find((bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID)?.name,
      ).toBe("Renamed volume box");

      await incorporateActions(
        [deleteUserBoundingBoxInVolumeTracing(REPLAYED_BOUNDING_BOX_ID, tracingId)],
        7,
      );
      expect(
        getVolume().userBoundingBoxes.some((bbox) => bbox.id === REPLAYED_BOUNDING_BOX_ID),
      ).toBe(false);
    });
  });

  describe("Bucket-special-cased actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTesting(context, "volume");
    });

    afterEach<WebknossosTestContext>(async (context) => {
      expect(hasRootSagaCrashed()).toBe(false);
      await context.api.tracing.save();
      expect(hasRootSagaCrashed()).toBe(false);
      context.tearDownPullQueues();
    });
    // volumeTracingId is the default volume layer name in the tests.
    const layerNameToElementClass = { volumeTracingId: "uint16", color: "uint8" } as const;

    it<WebknossosTestContext>("evicts and reloads the affected bucket for updateBucket", async ({
      api,
      mocks,
    }) => {
      const oldCellId = 11;
      const newCellId = 2;
      const position = [0, 0, 0] as Vector3;
      const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

      // Establishes the initial state: locally, the bucket at `position` holds oldCellId.
      vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
        createBucketResponseFunction(layerNameToElementClass, oldCellId, 5),
      );
      await api.data.reloadAllBuckets();

      const task = startSaga(function* () {
        expect(yield call(() => api.data.getDataValue(volumeTracingLayerName, position))).toBe(
          oldCellId,
        );

        vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
          createBucketResponseFunction(layerNameToElementClass, newCellId, 5),
        );

        yield* incorporateActionsEffect(
          [
            {
              name: "updateBucket" as const,
              value: {
                actionTracingId: volumeTracingLayerName,
                position,
                additionalCoordinates: undefined,
                mag: [1, 1, 1] as Vector3,
                cubeSize: 1024,
                base64Data: undefined,
              },
            },
          ],
          1,
        );
      });
      await task.toPromise();

      expect(await api.data.getDataValue(volumeTracingLayerName, position)).toBe(newCellId);
    });

    it<WebknossosTestContext>("evicts and reloads the affected bucket for deleteSegmentData", async ({
      api,
      mocks,
    }) => {
      const oldCellId = 11;
      const newCellId = 0;
      const position = [0, 0, 0] as Vector3;
      const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

      // Establishes the initial state: locally, the bucket at `position` holds oldCellId.
      vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
        createBucketResponseFunction(layerNameToElementClass, oldCellId, 5),
      );
      await api.data.reloadAllBuckets();
      expect(await api.data.getDataValue(volumeTracingLayerName, position)).toBe(oldCellId);

      vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
        createBucketResponseFunction(layerNameToElementClass, newCellId, 5),
      );

      const task = startSaga(function* () {
        // The bucket's raw pixel data holds a plain JS number here (uint16-backed layer), not a
        // bigint -- containsValue() below compares by strict equality, so the id must match that
        // representation for the bucket to actually be found and evicted.
        yield* incorporateActionsEffect(
          [
            {
              name: "deleteSegmentData" as const,
              value: { actionTracingId: volumeTracingLayerName, id: oldCellId },
            },
          ],
          1,
        );
      });
      await task.toPromise();

      expect(await api.data.getDataValue(volumeTracingLayerName, position)).toBe(newCellId);
    });
  });

  describe("Proofreading actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it<WebknossosTestContext>("merges agglomerates and records mesh artifacts for mergeAgglomerate", async (context) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());
      const { tracingId } = Store.getState().annotation.volumes[0];

      let result: ApplyingUpdateResults | undefined;
      const task = startSaga(function* () {
        yield* initializeMappingAndTool(context, tracingId);
        yield* expectMapping(tracingId, initialMapping);
        yield loadAgglomerateMeshes([1]);

        result = yield* incorporateActionsEffect([mergeAgglomerate(1n, 4n, 1n, 4n, tracingId)], 1);
      });
      await task.toPromise();

      expect(result?.success).toBe(true);
      await startSaga(function* () {
        yield* expectMapping(tracingId, expectedMappingAfterMerge);
      }).toPromise();
      expect(result?.artifactInfos.meshIdsToRemovePerLayer.get(tracingId)?.has(1n)).toBe(true);
      expect(result?.artifactInfos.meshesToLoadPerLayer.get(tracingId)?.has(1n)).toBe(true);
    });

    it<WebknossosTestContext>("splits agglomerates and records mesh artifacts for splitAgglomerate", async (context) => {
      const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
      const { tracingId } = Store.getState().annotation.volumes[0];

      let result: ApplyingUpdateResults | undefined;
      const task = startSaga(function* () {
        yield* initializeMappingAndTool(context, tracingId);
        yield* expectMapping(tracingId, initialMapping);
        yield loadAgglomerateMeshes([1]);

        // tryToIncorporateActions asks the (mocked) backend for the post-split agglomerate ids
        // (splitAgglomeratesInMapping -> getAgglomeratesForSegmentsFromTracingstore), so the mock's
        // own graph must already reflect the split -- exactly like a real backend would already
        // have processed it by the time this update action is incorporated here. initializeMappingAndTool
        // and loadAgglomerateMeshes above already bumped the mock's version a few times, so the batch
        // version below must match whatever removeEdge lands on, not a hardcoded number.
        backendMock.agglomerateMapping.removeEdge(1n, 2n, true);
        const backendVersionAfterSplit = backendMock.agglomerateMapping.currentVersion;

        result = yield* incorporateActionsEffect(
          [splitAgglomerate(1n, 2n, 1n, tracingId)],
          backendVersionAfterSplit,
        );
      });
      await task.toPromise();

      expect(result?.success).toBe(true);
      const mapping = Store.getState().temporaryConfiguration.activeMappingByLayer[tracingId]
        ?.mapping as Map<number, number> | undefined;
      // segmentId1 (1n) always keeps its agglomerate id; segmentId2 (2n, and 3n which hangs off of
      // it) get split off into a new agglomerate id. The exact new id is an internal detail of the
      // (already thoroughly tested elsewhere, see proofreading_split_mapping.spec.ts) mapping-split
      // machinery, so this only asserts the split actually happened, not which id it produced.
      expect(mapping?.get(1)).toBe(1);
      expect(mapping?.get(2)).not.toBe(1);
      expect(mapping?.get(2)).toBe(mapping?.get(3));
      expect(result?.artifactInfos.meshIdsToRemovePerLayer.get(tracingId)?.has(1n)).toBe(true);
      expect(result?.artifactInfos.meshesToLoadPerLayer.get(tracingId)?.size).toBeGreaterThan(0);
    });

    it("resolves updateMappingName against the AGGLOMERATE type and applies isEditable/isLocked", async () => {
      const { tracingId } = Store.getState().annotation.volumes[0];
      const getVolume = () => getVolumeTracingById(Store.getState().annotation, tracingId);
      expect(getVolume().hasEditableMapping).toBeFalsy();
      expect(getVolume().mappingIsLocked).toBeFalsy();

      await incorporateActions(
        [updateMappingName(sampleHdf5AgglomerateName, true, true, tracingId)],
        1,
      );

      expect(
        Store.getState().temporaryConfiguration.activeMappingByLayer[tracingId]?.mappingName,
      ).toBe(sampleHdf5AgglomerateName);
      expect(
        Store.getState().temporaryConfiguration.activeMappingByLayer[tracingId]?.mappingType,
      ).toBe("AGGLOMERATE");
      expect(getVolume().hasEditableMapping).toBe(true);
      expect(getVolume().mappingIsLocked).toBe(true);
    });
  });

  describe("Annotation-level metadata actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    describe("updateLayerMetadata / updateMetadataOfAnnotation", () => {
      it.each([true, false])(
        "applies a replayed layer rename to local state (areUnsavedChangesOfUser=%s)",
        async (areUnsavedChangesOfUser) => {
          const { tracingId } = Store.getState().annotation.annotationLayers[0];

          await incorporateActions(
            [updateAnnotationLayerName(tracingId, "Replayed Name")],
            1,
            areUnsavedChangesOfUser,
          );

          const layer = Store.getState().annotation.annotationLayers.find(
            (l) => l.tracingId === tracingId,
          );
          expect(layer?.name).toBe("Replayed Name");
        },
      );

      it("does not echo a replayed layer rename back into the save queue", async () => {
        const { tracingId } = Store.getState().annotation.annotationLayers[0];
        Store.dispatch(discardSaveQueueAction());

        Store.dispatch(startForwardingUpdateActionsAction());
        await incorporateActions([updateAnnotationLayerName(tracingId, "Replayed Name")], 1);
        Store.dispatch(finishForwardingUpdateActionsAction());

        expect(Store.getState().save.queue).toEqual([]);
      });

      it("does not echo a replayed description change back into the save queue", async () => {
        Store.dispatch(discardSaveQueueAction());

        Store.dispatch(startForwardingUpdateActionsAction());
        await incorporateActions([updateMetadataOfAnnotation("Replayed description")], 1);
        Store.dispatch(finishForwardingUpdateActionsAction());

        expect(Store.getState().save.queue).toEqual([]);
        expect(Store.getState().annotation.description).toBe("Replayed description");
      });

      it("still diffs a genuine local layer rename into the save queue outside of a rebase", () => {
        const { tracingId } = Store.getState().annotation.annotationLayers[0];
        Store.dispatch(discardSaveQueueAction());

        Store.dispatch(editAnnotationLayerAction(tracingId, { name: "Local Rename" }));

        const queuedActions = Store.getState().save.queue.flatMap((batch) => batch.actions);
        const matchingAction = queuedActions.find((a) => a.name === "updateLayerMetadata");
        expect(matchingAction?.value).toMatchObject({ tracingId, layerName: "Local Rename" });
      });

      it("diffs a genuine local edit against the reset baseline once a rebase has finished", async () => {
        const { tracingId } = Store.getState().annotation.annotationLayers[0];
        Store.dispatch(discardSaveQueueAction());

        Store.dispatch(startForwardingUpdateActionsAction());
        await incorporateActions([updateAnnotationLayerName(tracingId, "Replayed Name")], 1);
        Store.dispatch(finishForwardingUpdateActionsAction());

        expect(Store.getState().save.queue).toEqual([]);

        Store.dispatch(editAnnotationLayerAction(tracingId, { name: "Second Local Rename" }));

        const queuedActions = Store.getState().save.queue.flatMap((batch) => batch.actions);
        const layerNameActions = queuedActions.filter((a) => a.name === "updateLayerMetadata");
        expect(layerNameActions).toHaveLength(1);
        expect(layerNameActions[0]?.value).toMatchObject({
          tracingId,
          layerName: "Second Local Rename",
        });
      });
    });

    it("applies a replayed bookmark creation to local state and does not echo it back", async () => {
      Store.dispatch(discardSaveQueueAction());

      Store.dispatch(startForwardingUpdateActionsAction());
      await incorporateActions(
        [addBookmark({ id: 1, created: 123, name: "Replayed Bookmark", stateHash: "{}" })],
        1,
      );
      Store.dispatch(finishForwardingUpdateActionsAction());

      expect(Store.getState().annotation.bookmarks).toEqual([
        { id: 1, created: 123, name: "Replayed Bookmark", stateHash: "{}" },
      ]);
      expect(Store.getState().save.queue).toEqual([]);
    });

    it("applies addSegmentIndex", async () => {
      // The "hybrid" fixture's volume tracing already starts with hasSegmentIndex: true (and the
      // reducer's SET_HAS_SEGMENT_INDEX case is a one-way flag with no "unset" action), so this
      // can't observe a false -> true transition. It still exercises the switch case dispatching
      // setHasSegmentIndexAction without erroring, and pins the resulting value.
      const { tracingId } = Store.getState().annotation.volumes[0];

      await incorporateActions(
        [{ name: "addSegmentIndex" as const, value: { actionTracingId: tracingId } }],
        1,
      );

      expect(getVolumeTracingById(Store.getState().annotation, tracingId).hasSegmentIndex).toBe(
        true,
      );
    });

    describe("revertToVersion", () => {
      it("passes an own queued revert through unchanged (areUnsavedChangesOfUser=true)", async () => {
        vi.mocked(Toast.error).mockClear();
        const result = await incorporateActions([revertToVersion(1)], 1, true);

        expect(result?.success).toBe(true);
        expect(Store.getState().annotation.isUpdatingCurrentlyAllowed).toBe(true);
        expect(Toast.error).not.toHaveBeenCalled();
      });

      it("locks the session and shows a reload toast for a foreign revert (areUnsavedChangesOfUser=false)", async () => {
        vi.mocked(Toast.error).mockClear();
        const result = await incorporateActions([revertToVersion(1)], 1, false);

        expect(result?.success).toBe(false);
        expect(Store.getState().annotation.isUpdatingCurrentlyAllowed).toBe(false);
        expect(Toast.error).toHaveBeenCalledWith(
          expect.stringContaining("reverted to an earlier version"),
          expect.objectContaining({ sticky: true, customFooter: expect.anything() }),
        );
      });
    });
  });

  describe("Disallowed layer-set-changing actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it.each(allDisallowedActions)(
      "locks the session and shows a reload toast for $name",
      async ({ name, build }) => {
        const { tracingId } = Store.getState().annotation.volumes[0];
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.mocked(Toast.error).mockClear();

        const result = await incorporateActions([build(tracingId)], 1);

        expect(result?.success).toBe(false);
        expect(Store.getState().annotation.isUpdatingCurrentlyAllowed).toBe(false);
        expect(Toast.error).toHaveBeenCalledWith(
          expect.stringContaining("layers of this annotation were just changed"),
          expect.objectContaining({ sticky: true, customFooter: expect.anything() }),
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Cannot forward layer set changing action",
          name,
        );

        consoleWarnSpy.mockRestore();
      },
    );
  });

  describe("Legacy actions", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    });

    afterEach<WebknossosTestContext>((context) => {
      context.tearDownPullQueues();
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it.each(allUnsupportedLegacyActions)(
      "fails and logs a console error for legacy action $name",
      async ({ name, build }) => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await incorporateActions([build()], 1);

        expect(result?.success).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Cannot apply legacy action", name);

        consoleErrorSpy.mockRestore();
      },
    );
  });

  it("covers every update action type", () => {
    expect(seenActionTypes).toEqual(new Set(actionNamesList));
  });
});
