import { ColoredLogger } from "libs/utils";
import { call, put, select, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterMergeRebase,
  expectedMappingAfterSplit,
  initialMapping,
} from "./proofreading_fixtures";

describe("Proofreading", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should merge two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
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

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should split two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Prepare the server's reply for the upcoming split.
      vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [1, 1, 1],
            position2: [2, 2, 2],
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 10));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 2,
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping when the server has a new update action with a merge operation", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      ColoredLogger.logGreen("storing merge on server");
      backendMock.injectVersion(
        [
          {
            name: "mergeAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1,
              segmentId2: 4,
            },
          },
        ],
        4,
      );

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping when the server has a new update action with a split operation", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      backendMock.injectVersion(
        [
          {
            name: "splitAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1,
              segmentId2: 2,
            },
          },
        ],
        4,
      );

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates optimistically and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 5,
          segmentId2: 6,
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

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
      yield take("FINISH_MAPPING_INITIALIZATION");
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(expectedMappingAfterMergeRebase);
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates optimistically and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 3,
          segmentId2: 2,
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

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
      yield take("FINISH_MAPPING_INITIALIZATION");
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 8],
          [2, 8],
          [3, 1],
          [4, 8],
          [5, 8],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);
});
