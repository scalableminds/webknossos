import { call, put, select, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import { type SkeletonTracing, startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectedMappingAfterMerge, initialMapping } from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { TreeTypeEnum } from "viewer/constants";
import { mergeTreesAction } from "viewer/model/actions/skeletontracing_actions";

// TODOM: wait for agglomerate skeleton being properly loaded and then continue to do a proofreading action with it.
describe("Proofreading (With Agglomerate Skeleton interactions)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  // Agglomerate Skeletons
  it("should merge two agglomerates optimistically and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 5,
          segmentId2: 6,
          agglomerateId1: 4,
          agglomerateId2: 6,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield call(createEditableMapping);

      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));
      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(mocks.parseProtoTracing).mockRestore();
      yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);
      // Wait until skeleton saga has loaded the skeleton.
      yield take("ADD_TREES_AND_GROUPS");
      yield call(loadAgglomerateSkeletonAtPosition, [4, 4, 4]);
      // Wait until skeleton saga has loaded the skeleton.
      yield take("ADD_TREES_AND_GROUPS");
      const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
        (state: WebknossosState) => state.annotation.skeleton,
      );
      const agglomerateTrees = Array.from(
        skeletonWithAgglomerateTrees.trees
          .values()
          .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.length).toBe(2);
      const sourceNode = agglomerateTrees[0].nodes.getOrThrow(6);
      expect(sourceNode.untransformedPosition).toStrictEqual([3, 3, 3]);
      const targetNode = agglomerateTrees[1].nodes.getOrThrow(7);
      expect(targetNode.untransformedPosition).toStrictEqual([4, 4, 4]);
      yield put(mergeTreesAction(sourceNode.id, targetNode.id));

      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);
      // TODOM: The test seems to send infinite tree update actions.
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.
      const updates = context.receivedDataPerSaveRequest;
      console.log(updates);

      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      // Create first agglomerate tree (agglomerate 4: 4-5)
      expect(latestUpdateActionRequestPayload[0].actions.map((action) => action.name)).toEqual([
        "createTree",
        "createNode",
        "createNode",
        "createNode",
        "createEdge",
        "createEdge",
      ]);
      // Create second agglomerate tree already merged due to injected update (agglomerate 4: 4-5-6-7)
      expect(latestUpdateActionRequestPayload[1].actions.map((action) => action.name)).toEqual([
        "createTree",
        "createNode",
        "createNode",
        "createNode",
        "createNode",
        "createEdge",
        "createEdge",
        "createEdge",
      ]);
      // Merge both agglomerate trees
      expect(latestUpdateActionRequestPayload[2].actions.map((action) => action.name)).toEqual([
        "moveTreeComponent",
        "deleteTree",
        "createEdge",
        "updateActiveNode",
      ]);

      // Merge proofreading action
      expect(latestUpdateActionRequestPayload[3].actions).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 3,
            segmentId2: 4,
            agglomerateId1: 1,
            agglomerateId2: 4,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
          [6, 1],
          [7, 1],
        ]),
      );
    });

    await task.toPromise();
  });
  // TODO: code interleaving test where version is injected after agglomerate trees are created and before the merge.
});

// TODOM: Implement more tests for proofreading tree interactions.

// TODOM: Write test for backend manipulating same agglomerate skeleton

// TODO open skeleton interactions to test: ,["DELETE_EDGE", "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS"],
// TODOM: write tests for cutFromAllNeighbours
// TODOM: write tests for partitionedMinCut
