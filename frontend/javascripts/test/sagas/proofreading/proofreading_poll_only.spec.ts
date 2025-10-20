import { ColoredLogger } from "libs/utils";
import { call, select, put } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterSplit,
  initialMapping,
} from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { WkDevFlags } from "viewer/api/wk_dev";

describe("Proofreading (Poll only)", () => {
  const initialLiveCollab = WkDevFlags.liveCollab;
  beforeEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTesting(context, "hybrid");
    //Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = initialLiveCollab;
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should update the mapping when the server has a new update action with a merge operation", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      ColoredLogger.logGreen("1");

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      // OthersMayEdit = true is needed for polling to work properly as this test and the simulated
      // other user (via backendMock.injectVersion) are both editing the annotation in this test
      // (although the user of this test only sends empty updates). Else the polling logic would not work.
      yield put(setOthersMayEditForAnnotationAction(true));

      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      ColoredLogger.logGreen("storing merge on server");
      ColoredLogger.logGreen("1");
      backendMock.injectVersion(
        [
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

      const activeTool = yield select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping correctly when the server has first a new update action with a split then with a merge operation with segments unknown to the client", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [
      [7, 1337],
      [4, 1338],
    ]);
    // Initial Mapping
    // 1-2-3
    // 5-4-1338-1337-7-6
    // Loaded by client: 1, 2, 3, 4, 5, 6, 7

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
        ]),
      );

      // OthersMayEdit = true is needed for polling to work properly as this test and the simulated
      // other user (via backendMock.injectVersion) are both editing the annotation in this test
      // (although the user of this test only sends empty updates). Else the polling logic would not work.
      yield put(setOthersMayEditForAnnotationAction(true));

      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      backendMock.injectVersion(
        [
          {
            name: "splitAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1338,
              segmentId2: 1337,
              agglomerateId: 4,
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

      expect(mapping1).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 1339],
          [7, 1339],
        ]),
      );

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);

      backendMock.injectVersion(
        [
          {
            name: "mergeAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1337,
              segmentId2: 1338,
              agglomerateId1: 1339,
              agglomerateId2: 4,
            },
          },
        ],
        5,
      );

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping2 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping2).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1339],
          [5, 1339],
          [6, 1339],
          [7, 1339],
        ]),
      );

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

      // OthersMayEdit = true is needed for polling to work properly as this test and the simulated
      // other user (via backendMock.injectVersion) are both editing the annotation in this test
      // (although the user of this test only sends empty updates). Else the polling logic would not work.
      yield put(setOthersMayEditForAnnotationAction(true));

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
              agglomerateId: 1,
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

  it("should update the mapping correctly when the server has a new update action with a split operation with segments unknown to the client", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[7, 1337]]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // OthersMayEdit = true is needed for polling to work properly as this test and the simulated
      // other user (via backendMock.injectVersion) are both editing the annotation in this test
      // (although the user of this test only sends empty updates). Else the polling logic would not work.
      yield put(setOthersMayEditForAnnotationAction(true));

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
              agglomerateId: 1,
            },
          },
        ],
        4,
      );
      backendMock.injectVersion(
        [
          {
            name: "splitAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1338,
              segmentId2: 1337,
              agglomerateId: 6,
            },
          },
        ],
        5,
      );

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 1340],
          [7, 1340],
        ]),
      );

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping correctly when the server has a new update action with a merge and split operation with segments unknown to the client", async (context: WebknossosTestContext) => {
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

      // OthersMayEdit = true is needed for polling to work properly as this test and the simulated
      // other user (via backendMock.injectVersion) are both editing the annotation in this test
      // (although the user of this test only sends empty updates). Else the polling logic would not work.
      yield put(setOthersMayEditForAnnotationAction(true));

      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      backendMock.injectVersion(
        [
          {
            name: "mergeAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 7,
              segmentId2: 1337,
              agglomerateId1: 6,
              agglomerateId2: 1337,
            },
          },
        ],
        4,
      );
      backendMock.injectVersion(
        [
          {
            name: "splitAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 1338,
              segmentId2: 1337,
              agglomerateId: 6,
            },
          },
        ],
        5,
      );

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 1339],
          [7, 1339],
        ]),
      );

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);
});

// TODOM: Test where OthersMayEdit = true is not needed
