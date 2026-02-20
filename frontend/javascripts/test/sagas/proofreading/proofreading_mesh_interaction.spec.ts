import type { MinCutTargetEdge } from "admin/rest_api";
import isEqual from "lodash-es/isEqual";
import { call, put, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { delay } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import {
  minCutAgglomerateWithPositionAction,
  minCutPartitionsAction,
  proofreadMergeAction,
  toggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import {
  type ActiveMappingInfo,
  type NumberLike,
  startSaga,
  type WebknossosState,
} from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialMapping } from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

describe("Proofreading (with mesh actions)", () => {
  const initialLiveCollab = WkDevFlags.liveCollab;
  beforeEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = initialLiveCollab;
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function* simulateMergeAgglomeratesViaMeshes(
    context: WebknossosTestContext,
  ): Generator<any, void, any> {
    const { api } = context;
    const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
    yield call(initializeMappingAndTool, context, tracingId);
    const mapping0 = yield select(
      (state: WebknossosState) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(initialMapping);

    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
    yield put(setActiveCellAction(1, undefined, null, 1));

    yield call(createEditableMapping);

    // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
    const mapping1 = yield select(
      (state: WebknossosState) =>
        (
          getMappingInfo(
            state.temporaryConfiguration.activeMappingByLayer,
            tracingId,
          ) as ActiveMappingInfo
        ).mapping,
    );
    expect(mapping1).toEqual(initialMapping);
    yield put(setOthersMayEditForAnnotationAction(true));
    // Execute the actual merge and wait for the finished mapping.
    yield put(
      proofreadMergeAction(
        null, // mesh actions do not have a usable source position.
        1337,
        1337,
      ),
    );
    yield take("FINISH_MAPPING_INITIALIZATION");
    // Checking optimistic merge is not necessary as no "foreign" update was injected.
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.

    const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

    expect(mergeSaveActionBatch).toEqual([
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 1337,
          agglomerateId1: 1,
          agglomerateId2: 1337,
        },
      },
    ]);
  }

  // Mesh interactions tests
  it("should merge two agglomerates correctly even when merged segments are not loaded (such an action can be triggered via mesh proofreading)", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulateMergeAgglomeratesViaMeshes(context);

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          // [1337, 1], not loaded due to no rebasing performed as this test has no injected updated actions.
          // If there would be injected updates (simulating other users' changes) the segment id 1337 would
          // been looked up for rebasing and thus added to the loaded mapping.
          // [1338, 1], not loaded
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should load unknown unmapped segment ids of mesh merge operation when incorporating interfered update actions.", async (context: WebknossosTestContext) => {
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

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulateMergeAgglomeratesViaMeshes(context);

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
          [1337, 1], // loaded due to rebasing was necessary due to injected update action.
          // [1338, 1], not loaded
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  const mockEdgesForNormalAgglomerateMinCut = (mocks: WebknossosTestContext["mocks"]) =>
    vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockImplementation(
      async (
        _tracingStoreUrl: string,
        _tracingId: string,
        version: number,
        segmentsInfo: {
          partition1: NumberLike[];
          partition2: NumberLike[];
          mag: Vector3;
          agglomerateId: NumberLike;
          editableMappingId: string;
        },
      ): Promise<Array<MinCutTargetEdge>> => {
        if (version !== 6) {
          throw new Error("Unexpected version of min cut request:" + version);
        }
        const { agglomerateId, partition1, partition2 } = segmentsInfo;
        if (agglomerateId === 6 && isEqual(partition1, [1337]) && isEqual(partition2, [1338])) {
          return [
            {
              position1: [1337, 1337, 1337],
              position2: [1338, 1338, 1338],
              segmentId1: 1337,
              segmentId2: 1338,
            },
          ];
        }
        throw new Error("Unexpected min cut request");
      },
    );

  function* simulateSplitAgglomeratesViaMeshes(
    context: WebknossosTestContext,
  ): Generator<any, void, any> {
    const { api } = context;
    const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
    const expectedInitialMapping = new Map([
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 4],
      [5, 4],
      [6, 6],
      [7, 6],
    ]);

    yield call(initializeMappingAndTool, context, tracingId);
    const mapping0 = yield select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(expectedInitialMapping);

    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(6, { somePosition: [1337, 1337, 1337] }, tracingId));
    yield put(setActiveCellAction(6, undefined, null, 1337));

    yield call(createEditableMapping);

    // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
    const mapping1 = yield select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping1).toEqual(expectedInitialMapping);
    yield put(setOthersMayEditForAnnotationAction(true));
    // Execute the actual merge and wait for the finished mapping.
    yield put(
      minCutAgglomerateWithPositionAction(
        null, // mesh actions do not have a usable source position.
        1338,
        6,
      ),
    );
    yield take("FINISH_MAPPING_INITIALIZATION");
    // Checking optimistic merge is not necessary as no "foreign" update was injected.
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  }

  it("should update the mapping correctly if not loaded part of the mapping is changed due to own mesh split operation", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 6],
    //  [2, 6],
    //  [3, 6],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 6],
    //  [1338, 6]]
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [
      [7, 1337],
      [1338, 1],
    ]);

    mockEdgesForNormalAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulateSplitAgglomeratesViaMeshes(context);

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 6,
            segmentId1: 1337,
            segmentId2: 1338,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          // [1337, 6], not loaded due to no rebasing performed as this test has no injected updated actions.
          // If there would be injected updates (simulating other users' changes) the segment id 1337 would
          // been looked up for rebasing and thus added to the loaded mapping.
          // [1338, 1339], also not loaded. see above.
        ]),
      );
    });

    await task.toPromise();
  });

  it("should load unknown unmapped segment ids of mesh split operation when incorporating interfered update actions.", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 6],
    //  [2, 6],
    //  [3, 6],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 6],
    //  [1338, 6]]
    const backendMock = mockInitialBucketAndAgglomerateData(context, [
      [7, 1337],
      [1338, 1],
    ]);

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

    mockEdgesForNormalAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulateSplitAgglomeratesViaMeshes(context);

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            // Different to test above:
            agglomerateId: 4, // !Changed! due to interfered merge update action version 7. Would be aggloId 6,
            // but the merge made it a 4, because the split operation is after the injected version 7.
            segmentId1: 1337,
            segmentId2: 1338,
          },
        },
      ]);
      yield delay(400);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
          // Same here not loaded due to no rebasing
          [1337, 4], // loaded due to split mesh operation
          [1338, 1339], // loaded due to split mesh operation
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  const mockEdgesForPartitionedAgglomerateMinCut = (mocks: WebknossosTestContext["mocks"]) =>
    vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockImplementation(
      async (
        _tracingStoreUrl: string,
        _tracingId: string,
        version: number,
        segmentsInfo: {
          partition1: NumberLike[];
          partition2: NumberLike[];
          mag: Vector3;
          agglomerateId: NumberLike;
          editableMappingId: string;
        },
      ): Promise<Array<MinCutTargetEdge>> => {
        if (version !== 6) {
          throw new Error("Unexpected version of min cut request:" + version);
        }
        const { agglomerateId, partition1, partition2 } = segmentsInfo;
        if (
          agglomerateId === 1 &&
          isEqual(partition1, [1, 2]) &&
          isEqual(partition2, [1337, 1338])
        ) {
          return [
            {
              position1: [1, 1, 1],
              position2: [1338, 1338, 1338],
              segmentId1: 1,
              segmentId2: 1338,
            },
            {
              position1: [3, 3, 3],
              position2: [1337, 1337, 1337],
              segmentId1: 3,
              segmentId2: 1337,
            },
          ];
        }
        throw new Error("Unexpected min cut request");
      },
    );

  function* simulatePartitionedSplitAgglomeratesViaMeshes(
    context: WebknossosTestContext,
  ): Generator<any, void, any> {
    const { api } = context;
    const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
    const expectedInitialMapping = new Map([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 4],
      [5, 4],
      [6, 6],
      [7, 6],
    ]);

    yield call(initializeMappingAndTool, context, tracingId);
    const mapping0 = yield select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(expectedInitialMapping);

    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(6, { somePosition: [1337, 1337, 1337] }, tracingId));
    yield put(setActiveCellAction(6, undefined, null, 1337));

    yield call(createEditableMapping);

    // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
    const mapping1 = yield select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping1).toEqual(expectedInitialMapping);
    yield put(setOthersMayEditForAnnotationAction(true));

    //Activate Multi-split tool
    yield put(updateUserSettingAction("isMultiSplitActive", true));
    // Select partition 1
    yield put(toggleSegmentInPartitionAction(1, 1, 1));
    yield put(toggleSegmentInPartitionAction(2, 1, 1));
    // Select partition 2
    yield put(toggleSegmentInPartitionAction(1337, 2, 1));
    yield put(toggleSegmentInPartitionAction(1338, 2, 1));
    // Execute the actual merge and wait for the finished mapping.
    yield put(minCutPartitionsAction());
    yield take("FINISH_MAPPING_INITIALIZATION");
    // Checking optimistic merge is not necessary as no "foreign" update was injected.
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  }

  it("should perform partitioned min-cut correctly", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Thus, there should be the following circle of edges: 1-2-3-1337-1338-1.
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [
      [1, 1338],
      [3, 1337],
    ]);

    mockEdgesForPartitionedAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context);

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1,
            segmentId1: 1,
            segmentId2: 1338,
          },
        },
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1,
            segmentId1: 3,
            segmentId2: 1337,
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
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          [1337, 1339], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338, 1339], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );
    });

    await task.toPromise();
  });

  it("should result in not partitioned min cut if min-cutted edges are outdated due to interfering merge operations.", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Thus, there should be the following circle of edges: 1-2-3-1337-1338-1.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [
      [1, 1338],
      [3, 1337],
    ]);

    // Mapping after interference should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 1],
    //  [5, 1],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Contains two circles now but only one is split by the min-cut request.
    backendMock.planVersionInjection(7, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1,
          agglomerateId2: 4,
        },
      },
    ]);

    backendMock.planVersionInjection(8, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 5,
          segmentId2: 1337,
          agglomerateId1: 1,
          agglomerateId2: 1,
        },
      },
    ]);

    mockEdgesForPartitionedAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Generator<any, void, any> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context);

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1,
            segmentId1: 1,
            segmentId2: 1338,
          },
        },
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1,
            segmentId1: 3,
            segmentId2: 1337,
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
          [6, 6],
          [7, 6],
          [1337, 1], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338, 1], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );
    });

    await task.toPromise();
  });
});
