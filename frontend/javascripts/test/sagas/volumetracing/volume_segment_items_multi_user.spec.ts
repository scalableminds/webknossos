import { call, put } from "redux-saga/effects";
import {
  getFlattenedUpdateActions,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import {
  removeSegmentAction,
  setIdReservationsAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialMapping } from "../proofreading/proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "../proofreading/proofreading_test_utils";

describe("Collaborative editing of segment items", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should handle concurrent createSegment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, a segment with the following properties is created.
    const injectedSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
      anchorPosition: [1, 2, 3] as Vector3,
      additionalCoordinates: null,
      name: "Some Name",
      color: null,
      groupId: null,
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(4, [
      {
        name: "createSegment",
        value: injectedSegmentProps,
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegmentProps = { name: "Some Other Name", color: [128, 0, 0] as Vector3 };

      // Create the segment (creation also uses the updateSegmentAction redux action)
      yield put(updateSegmentAction(segmentId, updateSegmentProps, tracingId));

      const segmentBeforeSaving =
        Store.getState().annotation.volumes[0].segments.getNullable(segmentId);

      expect(segmentBeforeSaving).toMatchObject(updateSegmentProps);

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegment = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(updateSegment).toMatchObject([
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
            color: updateSegmentProps.color,
            name: updateSegmentProps.name,
          },
        },
      ]);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);

        expect(finalSegment).toMatchObject({
          anchorPosition: injectedSegmentProps.anchorPosition,
          name: updateSegmentProps.name,
          color: updateSegmentProps.color,
        });
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent updateSegment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, a segment with the following properties is created.
    // Note that the anchorPosition, in particular, will survive the rebase.
    // The local user will create the same segment with another name and a color
    // (which should then also be present in the final segment).
    const injectedSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
      anchorPosition: [1, 2, 3] as Vector3,
      additionalCoordinates: null,
      name: "Some Name by another user",
      color: null,
      groupId: 4,
      creationTime: Date.now(),
    };

    const injectedMetadataValue = {
      actionTracingId: "volumeTracingId",
      id: segmentId,
      upsertEntriesByKey: [
        {
          key: "BASE_1",
          stringValue: "changed by remote",
        },
        {
          key: "ADDED_BY_REMOTE",
          stringValue: "ADDED_BY_REMOTE",
        },
      ],
      removeEntriesByKey: ["BASE_2"],
    };
    backendMock.planVersionInjection(5, [
      {
        name: "updateMetadataOfSegment",
        value: injectedMetadataValue,
      },
      {
        name: "updateSegmentPartial",
        value: injectedSegmentProps,
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // TODO (#9036): without this save, the mutex strategy is not switched correctly. can we improve this?

      // Create the segment (creation also uses the updateSegmentAction redux action)
      // and save so that it exists in the base version.
      const baseSegmentProps = {
        name: "Some Name",
        color: [128, 0, 0] as Vector3,
        metadata: [
          {
            key: "BASE_1",
            stringValue: "BASE_1", // will be changed by both users
          },
          {
            key: "BASE_2", // will be deleted by remote user
            stringValue: "BASE_2",
          },
          {
            key: "BASE_3", // will be deleted by local user
            stringValue: "BASE_3",
          },
        ],
      };
      yield put(updateSegmentAction(segmentId, baseSegmentProps, tracingId));
      yield call(() => api.tracing.save());

      // The preparation is complete now.

      const updateSegmentProps = {
        color: [129, 0, 0] as Vector3,
        metadata: [
          {
            key: "BASE_1",
            stringValue: "changed by local user",
          },
          baseSegmentProps.metadata[1], // don't change BASE_2
          // BASE_3 is deleted
          {
            key: "ADDED_BY_LOCAL_USER",
            booleanValue: true,
          },
        ],
      };
      yield put(updateSegmentAction(segmentId, updateSegmentProps, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegment = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(updateSegment).toMatchObject([
        {
          name: "updateMetadataOfSegment",
          value: {
            actionTracingId: "volumeTracingId",
            id: segmentId,
            removeEntriesByKey: ["BASE_3"],
            upsertEntriesByKey: [
              updateSegmentProps.metadata[0], // BASE_1
              updateSegmentProps.metadata[2], // ADDED_BY_LOCAL_USER
            ],
          },
        },
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
            color: updateSegmentProps.color,
          },
        },
      ]);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);

        expect(finalSegment).toMatchObject({
          anchorPosition: injectedSegmentProps.anchorPosition,
          color: updateSegmentProps.color,
          name: injectedSegmentProps.name,
          groupId: injectedSegmentProps.groupId,
          metadata: [
            injectedMetadataValue.upsertEntriesByKey[1], // ADDED_BY_REMOTE
            updateSegmentProps.metadata[0], // BASE_1 (was changed by both but local user won the race)
            // BASE_2 was deleted by remote user
            // BASE_3 was deleted by local user
            updateSegmentProps.metadata[2], // ADDED_BY_LOCAL_USER
          ],
        });
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent two 'create and update segment' update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, a segment with the following properties is created.
    // Note that the anchorPosition, in particular, will survive the rebase.
    // The local user will create the same segment with another name and a color
    // (which should then also be present in the final segment).
    const injectedBaseSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
    };
    const injectedInitialSegmentProps = {
      anchorPosition: [1, 2, 3] as Vector3,
      additionalCoordinates: null,
      name: "Some Name",
      color: null,
      groupId: null,
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(4, [
      {
        name: "createSegment",
        value: { ...injectedBaseSegmentProps, ...injectedInitialSegmentProps },
      },
      {
        name: "updateSegmentPartial",
        value: { ...injectedBaseSegmentProps, name: "Some Name 2" },
      },
    ]);
    backendMock.planVersionInjection(5, [
      {
        name: "updateSegmentPartial",
        value: { ...injectedBaseSegmentProps, name: "Some Name 3", groupId: 2 },
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Other Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      // Update the segment
      const updateSegmentProps2 = { name: "Some Other Name 1", groupId: 1 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps2, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect([receivedUpdateActions.at(-2)]).toEqual(backendMock.injectionsPerVersion[5]);
      expect(receivedUpdateActions.at(-1)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          actionTracingId: tracingId,
          id: segmentId,
          name: updateSegmentProps2.name,
          groupId: updateSegmentProps2.groupId,
          color: updateSegmentProps1.color,
        },
      });
      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);

        expect(finalSegment).toMatchObject({
          anchorPosition: injectedInitialSegmentProps.anchorPosition,
          color: updateSegmentProps1.color,
          name: updateSegmentProps2.name,
          groupId: updateSegmentProps2.groupId,
        });
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent update and delete segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, a segment with the following properties is created.
    const injectedBaseSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
      anchorPosition: [1, 2, 3] as Vector3,
      additionalCoordinates: null,
      name: "Some Name",
      color: null,
      groupId: null,
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(5, [
      {
        name: "updateSegmentPartial",
        value: injectedBaseSegmentProps,
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Other Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      yield put(removeSegmentAction(segmentId, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const removeSegmentSaveAction = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(removeSegmentSaveAction).toMatchObject([
        {
          name: "deleteSegment",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
          },
        },
      ]);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);
        expect(finalSegment).toBeUndefined();
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent delete and update segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, the segment is deleted.
    backendMock.planVersionInjection(5, [
      {
        name: "deleteSegment",
        value: {
          actionTracingId: tracingId,
          id: segmentId,
        },
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = {
        name: "Some Other Name",
        color: [128, 0, 0] as Vector3,
      };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegmentProps2 = {
        groupId: 4,
        metadata: [{ key: "key", someStringValue: "someStringValue" }],
        isVisible: false,
      };
      yield put(updateSegmentAction(segmentId, updateSegmentProps2, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const removeSegmentSaveAction = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(removeSegmentSaveAction).toMatchObject([
        {
          name: "deleteSegment",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
          },
        },
      ]);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);
        expect(finalSegment).toBeUndefined();
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle multiple pending update segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const injectedSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
      anchorPosition: [1, 1, 1] as Vector3,
      name: "Some Name",
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(5, [
      {
        name: "updateSegmentPartial",
        value: injectedSegmentProps,
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegmentProps2 = { groupId: 4 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps2, tracingId));

      const updateSegmentProps3 = { anchorPosition: [1, 2, 3] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps3, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const expectedShapeWithTracingId = {
        ...updateSegmentProps1,
        ...injectedSegmentProps,
        ...updateSegmentProps2,
        ...updateSegmentProps3,
      };
      const { actionTracingId, ...expectedShape } = expectedShapeWithTracingId;

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect([receivedUpdateActions.at(-2)]).toEqual(backendMock.injectionsPerVersion[5]);
      expect(receivedUpdateActions.at(-1)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          ...updateSegmentProps2,
          ...updateSegmentProps3,
        },
      });
      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);
        expect(finalSegment).toMatchObject(expectedShape);
      }
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent delete segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const segmentId = 1;
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    // On the backend, the segment is deleted.
    backendMock.planVersionInjection(5, [
      {
        name: "deleteSegment",
        value: {
          actionTracingId: tracingId,
          id: segmentId,
        },
      },
    ]);

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = {
        name: "Some Name",
        color: [128, 0, 0] as Vector3,
        metadata: [{ key: "key", someStringValue: "someStringValue" }],
        isVisible: false,
      };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      yield put(removeSegmentAction(segmentId, tracingId));
      // The following save should NOT send another deleteSegment to the backend as it would
      // be superfluous
      yield call(() => api.tracing.save());

      const latestSaveRequest = context.receivedDataPerSaveRequest.at(-1);
      expect(latestSaveRequest).toMatchObject([
        {
          version: 5,
        },
      ]);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const finalSegment = state.annotation.volumes[0].segments.getNullable(segmentId);
        expect(finalSegment).toBeUndefined();
      }
    });

    await task.toPromise();
  }, 8000);
});

describe("ID reservation saga", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    vi.mocked(context.mocks.Request.sendJSONReceiveJSON).mockClear();
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function mockReserveIdsEndpoint(mocks: WebknossosTestContext["mocks"], ids: number[]) {
    vi.mocked(mocks.Request.sendJSONReceiveJSON).mockImplementation((url: string) => {
      if (url.includes("reserveIds")) {
        return Promise.resolve(ids);
      }
      return Promise.resolve({});
    });
  }

  it("should fetch new IDs and return the first when no reservations exist", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    mockReserveIdsEndpoint(mocks, [100, 101, 102, 103, 104]);

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reservations = Store.getState().annotation.volumes[0].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        { id: 100, used: true },
        { id: 101, used: false },
        { id: 102, used: false },
        { id: 103, used: false },
        { id: 104, used: false },
      ]);
    });

    await task.toPromise();
  });

  it("should use an existing reservation without calling the API when the buffer is sufficient", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // 3 usable reservations: 3 >= IDEAL_ID_BUFFER_SIZE / 2 (2.5), so no replenishment is triggered
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 100, used: false },
        { id: 101, used: false },
        { id: 102, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reserveIdsCalls = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("reserveIds"));
      expect(reserveIdsCalls).toHaveLength(0);
    });

    await task.toPromise();
  });

  it("should skip reservation IDs at or below the maximum segment group ID", async () => {
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Set up a segment group with groupId=10, making maxGroupId=10
    Store.dispatch(
      setSegmentGroupsAction([{ name: "Existing Group", groupId: 10, children: [] }], tracingId),
    );

    // 5 reservations: IDs 5 and 10 are stale (not > maxGroupId=10), IDs 15, 20, 25 are valid
    // 3 valid reservations >= IDEAL_ID_BUFFER_SIZE / 2 (2.5), so no replenishment is triggered
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 5, used: false },
        { id: 10, used: false },
        { id: 15, used: false },
        { id: 20, used: false },
        { id: 25, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      // IDs 5 and 10 are filtered; 15 is the first valid ID
      expect(id).toBe(15);
    });

    await task.toPromise();
  });

  it("should replenish the buffer after an ID is returned when the remaining count falls below the threshold", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // 2 usable reservations: 2 < IDEAL_ID_BUFFER_SIZE / 2 (2.5), so replenishment fires after the
    // first use. But replenishment is async — it runs concurrently with the next request.
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 200, used: false },
        { id: 201, used: false },
      ]),
    );

    mockReserveIdsEndpoint(mocks, [300, 301, 302, 303]);

    const task = startSaga(function* task() {
      const id1 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id1).toBe(200);

      const id2 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id2).toBe(201);

      // Buffer is now empty; this request must wait for the replenishment saga to complete.
      // After it returns we are guaranteed replenishment has run.
      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id3).toBe(300);

      const reservations = Store.getState().annotation.volumes[0].idReservations.SegmentGroup;
      expect(reservations).toEqual(
        expect.arrayContaining([
          { id: 300, used: true },
          { id: 301, used: false },
          { id: 302, used: false },
          { id: 303, used: false },
        ]),
      );
    });

    await task.toPromise();
  });

  it("should release stale (already-used) IDs when fetching new reservations", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Both existing reservations are marked used — no usable IDs, so the saga must fetch
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 5, used: true },
        { id: 10, used: true },
      ]),
    );

    mockReserveIdsEndpoint(mocks, [100, 101, 102, 103, 104]);

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reserveIdsCalls = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("reserveIds"));
      expect(reserveIdsCalls).toHaveLength(1);

      const [, options] = reserveIdsCalls[0];
      expect((options.data as Record<string, unknown>).numberOfIdsToReserve).toBe(5);
      // Used IDs must be released so the backend can reassign them
      expect((options.data as Record<string, unknown>).idsToRelease).toEqual(
        expect.arrayContaining([5, 10]),
      );
    });

    await task.toPromise();
  });

  it("should return a different ID for each sequential request", async () => {
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Enough reservations to avoid replenishment across three requests
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 100, used: false },
        { id: 101, used: false },
        { id: 102, used: false },
        { id: 103, used: false },
        { id: 104, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id1 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      const id2 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );

      expect(id1).toBe(100);
      expect(id2).toBe(101);
      expect(id3).toBe(102);
    });

    await task.toPromise();
  });
});
