import { call, put } from "redux-saga/effects";
import dummyUser from "test/fixtures/dummy_user";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { actionChannel, flush } from "typed-redux-saga";
import { type AnnotationCollaborationMode, AnnotationCollaborationModes } from "types/api_types";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  setCollaborationModeAction,
  setIsUpdatingAnnotationCurrentlyAllowedAction,
} from "viewer/model/actions/annotation_actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterSplit,
  initialMapping,
} from "./proofreading_fixtures";
import { loadAgglomerateTree1 } from "./proofreading_interaction_update_action_fixtures";
import {
  type BackendMock,
  expectSegmentList,
  getPositionForSegmentId,
  initializeMappingAndTool,
  makeMappingEditableForTest,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

describe.each(
  AnnotationCollaborationModes,
  // ["Exclusive"]
)("Proofreading (Poll only) with collaborationMode=%s", (collabMode: AnnotationCollaborationMode) => {
  function* initializePollOnlyAnnotation(
    context: WebknossosTestContext,
    tracingId: string,
    backendMock: BackendMock,
  ) {
    yield call(initializeMappingAndTool, context, tracingId);

    const mapping0 = yield* select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(initialMapping);

    yield makeAnnotationPollOnly(context, backendMock);
  }

  function* makeAnnotationPollOnly(context: WebknossosTestContext, backendMock: BackendMock) {
    const { api } = context;
    // Set collab mode to concurrent to be able to save the updates about initializing the mapping.
    yield put(setCollaborationModeAction("Concurrent"));
    yield call(() => api.tracing.save());
    context.receivedDataPerSaveRequest.length = 0; // Clear array in-place.

    // Now switch to a poll only mode: Simulate a different user in a different client session than the owner
    // and enable the actual collaborationMode that should be tested.
    const differentUser = {
      ...dummyUser,
      id: "dummy-user2-id",
      email: "dummy2@email.com",
      firstName: "First Name2",
      lastName: "Last Name2",
    };
    yield put(setActiveUserAction(differentUser));
    yield put(setCollaborationModeAction(collabMode));
    yield put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
    backendMock.canGrantMutex = false;
  }

  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should update the mapping when the server has a new update action with a merge operation", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      // Expect empty save queue as the user is not allowed to do updates.
      const saveQueue = yield select((state) => state.save.queue);
      expect(saveQueue.length).toBe(0);
      // Checking that only the injected update action was received.
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      expect(context.receivedDataPerSaveRequest[0].length).toBe(1);
      const updateBatch = context.receivedDataPerSaveRequest[0][0];
      expect(updateBatch.actions.length).toBe(1);
      expect(updateBatch.actions).toEqual([foreignMergeAction]);

      yield expectSegmentList(tracingId, []);

      const activeTool = yield* select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);
    });

    await task.toPromise();
  });

  it("should update the mapping correctly when the server has first a new update action with a split then with a merge operation with segments unknown to the client", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [7, 1337],
        [4, 1338],
      ],
      Store.getState(),
    );
    backendMock.canGrantMutex = false;
    // Initial Mapping
    // 1-2-3
    // 5-4-1338-1337-7-6
    // Loaded by client: 1, 2, 3, 4, 5, 6, 7

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield* select(
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

      yield* makeAnnotationPollOnly(context, backendMock);

      const foreignSplitAction = {
        name: "splitAgglomerate" as const,
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1338,
          segmentId2: 1337,
          agglomerateId: 4,
        },
      };
      console.log("injectVersion")
      backendMock.injectVersion([foreignSplitAction], 4);

      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      const mapping1 = yield* select(
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

      const mapping2 = yield* select(
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

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should update the mapping when the server has a new update action with a split operation", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
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

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should update the mapping correctly when the server has a new update action with a split operation with segments unknown to the client", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[7, 1337]], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
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

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should update the mapping correctly when the server has a new update action with a merge and split operation with segments unknown to the client", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
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

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should not perform a rebase when there are no local changes", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      const rebaseActionChannel = yield actionChannel(["PREPARE_REBASING", "FINISHED_REBASING"]);
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
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

      const activeTool = yield* select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should poll updates for a simple merge", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield initializePollOnlyAnnotation(context, tracingId, backendMock);

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

      const mapping1 = yield* select(
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

      const activeTool = yield* select((state) => state.uiInformation.activeTool);
      expect(activeTool).toBe(AnnotationTool.PROOFREAD);

      yield expectSegmentList(tracingId, []);
    });

    await task.toPromise();
  });

  it("should simply forward received update actions like agglomerate tree update actions without putting these changes to its own save queue or sending them to the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableForTest();

      yield* makeAnnotationPollOnly(context, backendMock);

      // Store current annotation version, calculate expected version after injecting updates and inject the agglomerate tree loading.
      const receivedAmountOfUpdateRequests = context.receivedDataPerSaveRequest.length;
      const versionBeforeForwardingAgglomerateTreeLoading = yield* select(
        (state) => state.annotation.version,
      );
      const injectedAgglomerateTreeLoadingUpdates = loadAgglomerateTree1;
      const expectedAmountOfUpdatesAfterInjection =
        receivedAmountOfUpdateRequests + loadAgglomerateTree1.length;
      backendMock.planMultipleVersionInjections(
        versionBeforeForwardingAgglomerateTreeLoading + 1,
        injectedAgglomerateTreeLoadingUpdates,
      );

      // Load the injected agglomerate tree updates and forward them.
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

      // Expect no pending or additional sent update requests.
      expect(context.receivedDataPerSaveRequest.length).toBe(expectedAmountOfUpdatesAfterInjection);
      let saveQueue = yield* select((state) => state.save.queue);
      expect(saveQueue.length).toBe(0);

      // Enforce saved state including diffing tracings and storing their changes.
      yield call(() => context.api.tracing.save());

      // Expect no pending or additional sent update requests.
      expect(context.receivedDataPerSaveRequest.length).toBe(expectedAmountOfUpdatesAfterInjection);
      saveQueue = yield* select((state) => state.save.queue);
      expect(saveQueue.length).toBe(0);

      yield expectSegmentList(tracingId, [{ id: 1, anchorPosition: [1, 1, 1] }]);
    });

    await task.toPromise();
  });
});
