import { ColoredLogger } from "libs/utils";
import { call, select } from "redux-saga/effects";
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

describe("Proofreading (Poll only)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

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
});
