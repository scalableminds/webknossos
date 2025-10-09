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
import { deleteEdgeAction, mergeTreesAction } from "viewer/model/actions/skeletontracing_actions";

function* performMergeTreesProofreading(
  context: WebknossosTestContext,
  shouldSaveAfterLoadingTrees: boolean,
): Generator<any, void, any> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(initialMapping);

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield call(createEditableMapping);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(initialMapping);
  // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
  // TODOM: Support integrating this action, if it originates from this user.
  yield put(setOthersMayEditForAnnotationAction(true));
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  yield call(loadAgglomerateSkeletonAtPosition, [4, 4, 4]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  if (shouldSaveAfterLoadingTrees) {
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  }
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
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );

  expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
}

function* performSplitTreesProofreading(context: WebknossosTestContext): Generator<any, void, any> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(initialMapping);

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield call(createEditableMapping);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(initialMapping);
  // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
  // TODOM: Support integrating this action, if it originates from this user.
  yield put(setOthersMayEditForAnnotationAction(true));
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
    (state: WebknossosState) => state.annotation.skeleton,
  );
  const agglomerateTrees = Array.from(
    skeletonWithAgglomerateTrees.trees
      .values()
      .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
  );
  expect(agglomerateTrees.length).toBe(1);
  const sourceNode = agglomerateTrees[0].nodes.getOrThrow(5);
  expect(sourceNode.untransformedPosition).toStrictEqual([2, 2, 2]);
  const targetNode = agglomerateTrees[0].nodes.getOrThrow(6);
  expect(targetNode.untransformedPosition).toStrictEqual([3, 3, 3]);
  yield put(deleteEdgeAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");

  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
}

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

  it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
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
      yield performMergeTreesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_simple.json",
      );
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
  }, 8000);

  it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate interfering other merge action from backend correctly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
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
      yield performMergeTreesProofreading(context, true);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_interfered.json",
      );

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
  }, 8000);

  it("should merge two agglomerate skeletons if interfering merge makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
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

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMergeTreesProofreading(context, true);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_interfered_no-op.json",
      );

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
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should split agglomerate skeleton optimistically, perform the split proofreading action and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(8, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 2,
          agglomerateId: 1,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_simple.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1340],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should split two agglomerate skeletons optimistically, perform the split proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(8, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 3,
          segmentId2: 6,
          agglomerateId1: 1339,
          agglomerateId2: 6,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_interfered_merge.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 and 6 were merged and then split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 1339],
          [7, 1339],
        ]),
      );
    });

    await task.toPromise();
  });

  it("should split two agglomerate skeletons if interfering merge makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(8, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 2,
          segmentId2: 3,
          agglomerateId: 1,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_interfered_no-op.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 and 6 were merged and then split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
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
