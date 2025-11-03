import { ColoredLogger } from "libs/utils";
import { call, select, put } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  disableSavingAction,
  dispatchEnsureHasNewestVersionAsync,
} from "viewer/model/actions/save_actions";
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
import {
  setIsUpdatingAnnotationCurrentlyAllowedAction,
  setOthersMayEditForAnnotationAction,
} from "viewer/model/actions/annotation_actions";
import { WkDevFlags } from "viewer/api/wk_dev";
import { actionChannel, flush } from "typed-redux-saga";

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
      context.receivedDataPerSaveRequest.length = 0;

      const foreignMergeAction = {
        name: "mergeAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1,
          agglomerateId2: 4,
        },
      };
      backendMock.injectVersion([foreignMergeAction], 4);
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch.actions.length).toBe(1);
      expect(updateBatch.actions).toEqual([foreignMergeAction]);

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
      context.receivedDataPerSaveRequest.length = 0;
      const foreignSplitAction = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1338,
          segmentId2: 1337,
          agglomerateId: 4,
        },
      };
      backendMock.injectVersion([foreignSplitAction], 4);

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
      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch1 = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch1.actions.length).toBe(1);
      expect(updateBatch1.actions).toEqual([foreignSplitAction]);

      const foreignMergeAction = {
        name: "mergeAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1337,
          segmentId2: 1338,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      };
      backendMock.injectVersion([foreignMergeAction], 5);

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

      // Checking that only the injected update action was received.
      // split action:
      expect(context.receivedDataPerSaveRequest.length).toBe(2);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch2 = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch2.actions.length).toBe(1);
      expect(updateBatch2.actions).toEqual([foreignSplitAction]);
      // merge action:
      expect(context.receivedDataPerSaveRequest[1].length).toBe(1);
      const updateBatch3 = context.receivedDataPerSaveRequest[1][0];
      expect(updateBatch3.actions.length).toBe(1);
      expect(updateBatch3.actions).toEqual([foreignMergeAction]);
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
      context.receivedDataPerSaveRequest.length = 0;

      const foreignSplitAction = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 2,
          agglomerateId: 1,
        },
      };
      backendMock.injectVersion([foreignSplitAction], 4);

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch.actions.length).toBe(1);
      expect(updateBatch.actions).toEqual([foreignSplitAction]);
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
      context.receivedDataPerSaveRequest.length = 0;

      const foreignSplitAction1 = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 2,
          agglomerateId: 1,
        },
      };
      const foreignSplitAction2 = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1338,
          segmentId2: 1337,
          agglomerateId: 6,
        },
      };
      backendMock.injectVersion([foreignSplitAction1], 4);
      backendMock.injectVersion([foreignSplitAction2], 5);

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

      // Checking that only the injected update actions were received.
      // split 1
      expect(context.receivedDataPerSaveRequest.length).toBe(2);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch1 = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch1.actions.length).toBe(1);
      expect(updateBatch1.actions).toEqual([foreignSplitAction1]);
      //split 2
      expect(context.receivedDataPerSaveRequest[1].length).toBe(1);
      const updateBatch2 = context.receivedDataPerSaveRequest[1][0];
      expect(updateBatch2.actions.length).toBe(1);
      expect(updateBatch2.actions).toEqual([foreignSplitAction2]);
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
      context.receivedDataPerSaveRequest.length = 0;

      const foreignMergeAction = {
        name: "mergeAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 7,
          segmentId2: 1337,
          agglomerateId1: 6,
          agglomerateId2: 1337,
        },
      };
      const foreignSplitAction = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1338,
          segmentId2: 1337,
          agglomerateId: 6,
        },
      };
      backendMock.injectVersion([foreignMergeAction], 4);
      backendMock.injectVersion([foreignSplitAction], 5);

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

      // Checking that only the injected update actions were received.
      expect(context.receivedDataPerSaveRequest.length).toBe(2);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch1 = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch1.actions.length).toBe(1);
      expect(updateBatch1.actions).toEqual([foreignMergeAction]);
      expect(context.receivedDataPerSaveRequest[1].length).toBe(1);
      const updateBatch2 = context.receivedDataPerSaveRequest[1][0];
      expect(updateBatch2.actions.length).toBe(1);
      expect(updateBatch2.actions).toEqual([foreignSplitAction]);
    });

    await task.toPromise();
  }, 8000);

  it("should not perform a rebase when there are no local changes", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      const rebaseActionChannel = yield actionChannel(["PREPARE_REBASING", "FINISHED_REBASING"]);
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
      context.receivedDataPerSaveRequest.length = 0;

      const foreignMergeAction = {
        name: "mergeAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1,
          agglomerateId2: 4,
        },
      };
      backendMock.injectVersion([foreignMergeAction], 4);
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch.actions.length).toBe(1);
      expect(updateBatch.actions).toEqual([foreignMergeAction]);

      // Asserting no rebasing relevant actions were triggered.
      const rebasingActions = yield flush(rebaseActionChannel);
      expect(rebasingActions.length).toBe(0);

      const activeTool = yield select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);
    });

    await task.toPromise();
  }, 8000);

  async function testPollWithUserNotAllowedToSave(
    context: WebknossosTestContext,
    othersMayEdit: boolean,
  ) {
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

      if (othersMayEdit) {
        yield put(setOthersMayEditForAnnotationAction(true));
      }

      yield call(() => api.tracing.save());
      // Disable annotation saving: Simulating that this user does not edit the annotation but should be able to pull updates.
      yield put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
      yield put(disableSavingAction());
      context.receivedDataPerSaveRequest.length = 0;

      const foreignMergeAction = {
        name: "mergeAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1,
          agglomerateId2: 4,
        },
      };

      backendMock.injectVersion([foreignMergeAction], 4);
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch.actions.length).toBe(1);
      expect(updateBatch.actions).toEqual([foreignMergeAction]);

      const activeTool = yield select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);
    });

    await task.toPromise();
  }

  it("should poll updates even when othersMayEdit it turned off and updating is not allowed by current user", async (context: WebknossosTestContext) => {
    const othersMayEdit = false;
    await testPollWithUserNotAllowedToSave(context, othersMayEdit);
  }, 8000);

  it("should poll updates with othersMayEdit turned on but updating is not allowed by current user", async (context: WebknossosTestContext) => {
    const othersMayEdit = true;
    await testPollWithUserNotAllowedToSave(context, othersMayEdit);
  }, 8000);
});
