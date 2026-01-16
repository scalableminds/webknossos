import { call, put } from "redux-saga/effects";
import {
  setupWebknossosForTesting,
  type WebknossosTestContext,
  getFlattenedUpdateActions,
} from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import {
  removeSegmentAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialMapping } from "../proofreading/proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "../proofreading/proofreading_test_utils";
import type { Vector3 } from "viewer/constants";

describe("Collaborative editing of segment items", () => {
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

  it("should handle concurrent createSegment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
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
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);

      expect(finalSegment).toMatchObject({
        anchorPosition: injectedSegmentProps.anchorPosition,
        name: updateSegmentProps.name,
        color: updateSegmentProps.color,
      });
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent updateSegment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      id: 1,
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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
      yield call(() => api.tracing.save()); // todop: without this shape, the mutex strategy is not switched correctly. can we improve this?

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
            id: 1,
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
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);

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
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent two 'create and update segment' update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Other Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      // Update the segment
      const updateSegmentProps2 = { name: "Some Other Name 1", groupId: 1 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps2, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect(receivedUpdateActions.at(-2)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          actionTracingId: tracingId,
          id: segmentId,
          color: updateSegmentProps1.color,
        },
      });
      expect(receivedUpdateActions.at(-1)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          actionTracingId: tracingId,
          id: segmentId,
          name: updateSegmentProps2.name,
          groupId: updateSegmentProps2.groupId,
        },
      });
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);

      expect(finalSegment).toMatchObject({
        anchorPosition: injectedInitialSegmentProps.anchorPosition,
        color: updateSegmentProps1.color,
        name: updateSegmentProps2.name,
        groupId: updateSegmentProps2.groupId,
      });
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent update and delete segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
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
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);
      expect(finalSegment).toBeUndefined();
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent delete and update segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Other Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps1, tracingId));

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const updateSegmentProps2 = { groupId: 4 };
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
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);
      expect(finalSegment).toBeUndefined();
    });

    await task.toPromise();
  }, 8000);

  it("should handle multiple pending update segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
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

      expect(receivedUpdateActions.at(-2)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          ...updateSegmentProps2,
        },
      });
      expect(receivedUpdateActions.at(-1)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          ...updateSegmentProps3,
        },
      });
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);
      expect(finalSegment).toMatchObject(expectedShape);
    });

    await task.toPromise();
  }, 8000);

  it("should handle concurrent delete segment update actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // Create the segment (creation also uses the updateSegmentAction redux action)
      const updateSegmentProps1 = { name: "Some Name", color: [128, 0, 0] as Vector3 };
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
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);
      expect(finalSegment).toBeUndefined();
    });

    await task.toPromise();
  }, 8000);
});
