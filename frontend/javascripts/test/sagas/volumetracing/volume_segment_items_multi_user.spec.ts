import { call, put } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { updateSegmentAction } from "viewer/model/actions/volumetracing_actions";
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
import _ from "lodash";
import type { Vector3 } from "viewer/constants";
import { ColoredLogger } from "libs/utils";

describe("Proofreading (Multi User)", () => {
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
    // Note that the anchorPosition, in particular, will survive the rebase.
    // The local user will create the same segment with another name and a color
    // (which should then also be present in the final segment).
    const injectedSegmentProps = {
      actionTracingId: tracingId,
      id: segmentId,
      anchorPosition: [1, 2, 3],
      name: "Some Name",
      color: null,
      groupId: null,
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(4, [
      {
        name: "createSegment",
        _injected: true, // todop: only for debugging purposes. remove again
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

      yield put(updateSegmentAction(segmentId, updateSegmentProps, tracingId));

      const segmentBeforeSaving =
        Store.getState().annotation.volumes[0].segments.getNullable(segmentId);

      expect(segmentBeforeSaving).toMatchObject(updateSegmentProps);

      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      console.log(
        "context.receivedDataPerSaveRequest",
        _.flatten(context.receivedDataPerSaveRequest).map((g) => g.actions),
      );

      const updateSegment = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      for (const batch of context.receivedDataPerSaveRequest.at(-1)!) {
        console.log("batch", batch);
        for (const action of batch.actions) {
          console.log("action", action);
        }
      }

      // todop: check that changedPropertyNames is not in updateSegment
      expect(updateSegment).toMatchObject([
        {
          name: "updateSegment",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
            anchorPosition: injectedSegmentProps.anchorPosition,
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
      anchorPosition: [1, 2, 3],
      name: "Some Name by another user",
      color: null,
      groupId: 4,
      creationTime: Date.now(),
      metadata: [],
    };

    backendMock.planVersionInjection(5, [
      {
        name: "updateSegment",
        _injected: true, // todop: only for debugging purposes. remove again
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

      // Create the segment and save so that it exists in the base version.
      const baseSegmentProps = { name: "Some Name", color: [128, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, baseSegmentProps, tracingId));
      yield call(() => api.tracing.save());

      ColoredLogger.logGreen("Set up complete.");

      const updateSegmentProps = { color: [129, 0, 0] as Vector3 };
      yield put(updateSegmentAction(segmentId, updateSegmentProps, tracingId));

      ColoredLogger.logGreen("Trying to save color 129.");
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      // console.log(
      //   "context.receivedDataPerSaveRequest",
      //   _.flatten(context.receivedDataPerSaveRequest).map((g) => g.actions),
      // );

      const updateSegment = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      // for (const batch of context.receivedDataPerSaveRequest.at(-1)!) {
      //   console.log("batch", batch);
      //   for (const action of batch.actions) {
      //     console.log("action", action);
      //   }
      // }

      // todop: check that changedPropertyNames is not in updateSegment
      expect(updateSegment).toMatchObject([
        {
          name: "updateSegment",
          value: {
            actionTracingId: tracingId,
            id: segmentId,
            anchorPosition: injectedSegmentProps.anchorPosition,
            color: updateSegmentProps.color,
            name: injectedSegmentProps.name,
            groupId: injectedSegmentProps.groupId,
          },
        },
      ]);
      const finalSegment = Store.getState().annotation.volumes[0].segments.getNullable(1);

      expect(finalSegment).toMatchObject({
        anchorPosition: injectedSegmentProps.anchorPosition,
        color: updateSegmentProps.color,
        name: injectedSegmentProps.name,
        groupId: injectedSegmentProps.groupId,
      });
    });

    await task.toPromise();
  }, 8000);

  // todop: maybe test that another user did create and update a segment, and the local user
  // did the same?
});
