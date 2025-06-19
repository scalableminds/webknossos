import type { Saga } from "viewer/model/sagas/effect-generators";
import { call, put, select, take } from "redux-saga/effects";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { powerOrga } from "test/fixtures/dummy_organization";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { proofreadMergeAction, minCutAgglomerateWithPositionAction } from "viewer/model/actions/proofread_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryToIncorporateActions } from "viewer/model/sagas/save_saga";

function* initializeMappingAndTool(context: WebknossosTestContext, tracingId: string): Saga<void> {
  const { api } = context;
  // Set up organization with power plan (necessary for proofreading)
  // and zoom in so that buckets in mag 1, 1, 1 are loaded.
  yield put(setActiveOrganizationAction(powerOrga));
  yield put(setZoomStepAction(0.3));
  const currentMag = yield select((state) => getCurrentMag(state, tracingId));
  expect(currentMag).toEqual([1, 1, 1]);

  // Activate agglomerate mapping and wait for finished mapping initialization
  // (unfortunately, that action is dispatched twice; once for the activation and once
  // for the changed BucketRetrievalSource). Ideally, this should be refactored away.
  yield put(setMappingAction(tracingId, sampleHdf5AgglomerateName, "HDF5"));
  yield take("FINISH_MAPPING_INITIALIZATION");

  yield take("FINISH_MAPPING_INITIALIZATION");

  // Activate the proofread tool. WK will reload the bucket data and apply the mapping
  // locally (acknowledged by FINISH_MAPPING_INITIALIZATION).
  yield put(setToolAction(AnnotationTool.PROOFREAD));
  yield take("FINISH_MAPPING_INITIALIZATION");

  // Read data from the 0,0,0 bucket so that it is in memory (important because the mapping
  // is only maintained for loaded buckets).
  const valueAt444 = yield call(() => api.data.getDataValue(tracingId, [4, 4, 4], 0));
  expect(valueAt444).toBe(4);
  // Once again, we wait for FINISH_MAPPING_INITIALIZATION because the mapping is updated
  // for the keys that are found in the newly loaded bucket.
  yield take("FINISH_MAPPING_INITIALIZATION");
}

function mockInitialBucketAndAgglomerateData(context: WebknossosTestContext) {
  const { mocks } = context;
  vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    createBucketResponseFunction(Uint16Array, 1, 5, [
      { position: [0, 0, 0], value: 1337 },
      { position: [1, 1, 1], value: 1 },
      { position: [2, 2, 2], value: 2 },
      { position: [3, 3, 3], value: 3 },
      { position: [4, 4, 4], value: 4 },
      { position: [5, 5, 5], value: 5 },
      { position: [6, 6, 6], value: 6 },
      { position: [7, 7, 7], value: 7 },
    ]),
  );
  mocks.getCurrentMappingEntriesFromServer.mockReturnValue([
    [1, 10],
    [2, 10],
    [3, 10],
    [4, 11],
    [5, 11],
    [6, 12],
    [7, 12],
    [8, 13],
    [1337, 1337],
  ]);
}

const initialMapping = new Map([
  [1, 10],
  [2, 10],
  [3, 10],
  [4, 11],
  [5, 11],
  [6, 12],
  [7, 12],
  [1337, 1337]
]);

const expectedMappingAfterMerge = new Map([
  [1, 10],
  [2, 10],
  [3, 10],
  [4, 10],
  [5, 10],
  [6, 12],
  [7, 12],
  [1337, 1337]
])

const expectedMappingAfterSplit = new Map([
  [1, 9],
  [2, 10],
  [3, 10],
  [4, 11],
  [5, 11],
  [6, 12],
  [7, 12],
  [1337, 1337]
])

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
      expect(mapping0).toEqual(
        initialMapping,
      );

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1, 4));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping).toEqual(
        expectedMappingAfterMerge,
      );

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([{
        name: 'mergeAgglomerate',
        value: {
          actionTracingId: 'volumeTracingId',
          agglomerateId1: 10,
          agglomerateId2: 11,
          segmentId1: 1,
          segmentId2: 4,
          mag: [1, 1, 1]
        }
      }])
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
      expect(mapping0).toEqual(
        initialMapping,
      );

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Prepare the server's reply for the upcoming split.
      vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(Promise.resolve([
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        },
      ]))
      // Already prepare the server's reply for mapping requests that will be sent
      // after the split.
      mocks.getCurrentMappingEntriesFromServer.mockReturnValue([
        [1, 9],
        [2, 10],
        [3, 10],
      ]);

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 10));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(
        expectedMappingAfterSplit,
      );

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([{
        name: 'splitAgglomerate',
        value: {
          actionTracingId: 'volumeTracingId',
          agglomerateId: 10,
          segmentId1: 1,
          segmentId2: 2,
          mag: [1, 1, 1]
        }
      }])
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping when a the server has a new update action with a merge operation", async (context: WebknossosTestContext) => {
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
      expect(mapping0).toEqual(
        initialMapping,
      );
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      yield call(tryToIncorporateActions, [{
        version: 1, value: [{
          name: 'mergeAgglomerate',
          value: {
            actionTracingId: 'volumeTracingId',
            actionTimestamp: 0,
            agglomerateId1: 10,
            agglomerateId2: 11,
            segmentId1: 1,
            segmentId2: 4,
            mag: [1, 1, 1]
          }
        }]
      }])

      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(
        expectedMappingAfterMerge,
      );

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping when a the server has a new update action with a split operation", async (context: WebknossosTestContext) => {
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
      expect(mapping0).toEqual(
        initialMapping,
      );
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      // Already prepare the server's reply for mapping requests that will be sent
      // after the split.
      mocks.getCurrentMappingEntriesFromServer.mockReturnValue([
        [1, 9],
        [2, 10],
        [3, 10],
      ]);

      yield call(tryToIncorporateActions, [{
        version: 1, value: [{
          name: 'splitAgglomerate',
          value: {
            actionTracingId: 'volumeTracingId',
            actionTimestamp: 0,
            agglomerateId: 10,
            segmentId1: 1,
            segmentId2: 2,
            mag: [1, 1, 1]
          }
        }]
      }])

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(
        expectedMappingAfterSplit,
      );

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);
});
