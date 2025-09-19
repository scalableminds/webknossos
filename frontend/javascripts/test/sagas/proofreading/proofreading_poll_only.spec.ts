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
import { WkDevFlags } from "viewer/api/wk_dev";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";

describe("Proofreading (Poll only)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
    //Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
  });

  afterEach<WebknossosTestContext>(async (context) => {
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
            },
          },
        ],
        4,
      );
      WkDevFlags.logActions = true;
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
});
