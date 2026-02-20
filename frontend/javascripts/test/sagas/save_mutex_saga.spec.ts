import update from "immutability-helper";
import { sleep } from "libs/utils";
import { call, put, take } from "redux-saga/effects";
import { powerOrga } from "test/fixtures/dummy_organization";
import { tracing as volumeTracing } from "test/fixtures/volumetracing_server_objects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { ServerSkeletonTracing, ServerVolumeTracing } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { restartSagaAction } from "viewer/model/actions/actions";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import {
  doneSavingAction,
  ensureHasAnnotationMutexAction,
} from "viewer/model/actions/save_actions";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockInitialBucketAndAgglomerateData } from "./proofreading/proofreading_test_utils";

const blockingUser = { firstName: "Sample", lastName: "User", id: "1111" };

function makeProofreadAnnotation(
  tracings: (ServerSkeletonTracing | ServerVolumeTracing)[],
): (ServerSkeletonTracing | ServerVolumeTracing)[] {
  return tracings.map((tracing) => {
    if (tracing.typ === "Volume" && tracing.id === volumeTracing.id) {
      return update(tracing, {
        hasEditableMapping: { $set: true },
        mappingName: { $set: "volumeTracingId" },
        mappingIsLocked: { $set: true },
      });
    }
    return tracing;
  });
}

async function makeProofreadMerge(
  context: WebknossosTestContext,
  waitTillFinished: boolean,
): Promise<void> {
  const { annotation } = Store.getState();
  const { tracingId } = annotation.volumes[0];

  const task = startSaga(function* () {
    yield put(setActiveOrganizationAction(powerOrga));
    yield put(setZoomStepAction(0.3));
    const currentMag = yield select((state) => getCurrentMag(state, tracingId));
    expect(currentMag).toEqual([1, 1, 1]);
    yield put(setToolAction(AnnotationTool.PROOFREAD));

    // Read data from the 0,0,0 bucket so that it is in memory (important because the mapping
    // is only maintained for loaded buckets). => Forces loading of mapping.
    const valueAt444 = yield call(() => context.api.data.getDataValue(tracingId, [4, 4, 4], 0));
    expect(valueAt444).toBe(4);
    yield take("SET_MAPPING");
    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
    yield put(setActiveCellAction(1));
    // Execute the actual merge and wait for the finished mapping.
    yield put(proofreadMergeAction([4, 4, 4], 1));
    yield take("SET_BUSY_BLOCKING_INFO_ACTION");
    if (waitTillFinished) {
      // Wait for UI made busy and back to idle again to ensure saving of the whole sagas is done.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION");
    }
  });
  await task.toPromise();
}

function* assertMutexStoreProperties(
  hasAnnotationMutex: boolean,
  blockedByUser: any,
  isUpdatingCurrentlyAllowed: boolean,
): Generator<any, void, any> {
  const hasAnnotationMutexInStore = yield select(
    (state) => state.save.mutexState.hasAnnotationMutex,
  );
  expect(hasAnnotationMutexInStore).toBe(hasAnnotationMutex);
  const blockedByUserInStore = yield select((state) => state.save.mutexState.blockedByUser);
  expect(blockedByUserInStore).toBe(blockedByUser);
  const isUpdatingCurrentlyAllowedInStore = yield select(
    (state) => state.annotation.isUpdatingCurrentlyAllowed,
  );
  expect(isUpdatingCurrentlyAllowedInStore).toBe(isUpdatingCurrentlyAllowed);
}

const initialLiveCollab = WkDevFlags.liveCollab;

async function setupWebknossosForTestingWithRestrictions(
  context: WebknossosTestContext,
  othersMayEdit: boolean,
  allowUpdate: boolean,
  makeProofread: boolean = false,
  tracingTestMode: "hybrid" | "multiVolume" = "hybrid",
) {
  await setupWebknossosForTesting(
    context,
    tracingTestMode,
    ({ tracings, annotationProto, dataset, annotation }) => {
      const annotationWithUpdatingAllowedTrue = update(annotation, {
        restrictions: { allowUpdate: { $set: allowUpdate }, allowSave: { $set: allowUpdate } },
        othersMayEdit: { $set: othersMayEdit },
      });
      return {
        tracings: makeProofread ? makeProofreadAnnotation(tracings) : tracings,
        annotationProto,
        dataset,
        annotation: annotationWithUpdatingAllowedTrue,
      };
    },
  );
}

describe("Save Mutex Saga", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
    Store.dispatch(restartSagaAction());
    vi.clearAllMocks(); // clears call counts of *all* spies
    WkDevFlags.liveCollab = initialLiveCollab;
  });
  // Properties that can influence whether mutex acquisition is called are:
  // - othersMayEdit
  // - isUpdatingCurrentlyAllowed
  // - activeTool
  // - activeVolumeTracing
  it<WebknossosTestContext>("An annotation with allowUpdate = false and othersMayEdit = false should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTestingWithRestrictions(context, false, false);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = false and othersMayEdit = true should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTestingWithRestrictions(context, true, false);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = true and othersMayEdit = false should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    // allowUpdate = true and othersMayEdit = false are the defaults for the annotation,
    // no manual changes via a function passed to setupWebknossosForTesting is needed
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should try to acquire the annotation mutex in liveCollab scenario due to no editable mapping being active.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should not try to acquire the annotation mutex in liveCollab scenario due active editable mapping.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("A not-liveCollab annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTestingWithRestrictions(context, true, true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation where othersMayEdit is turned on should try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      yield put(setOthersMayEditForAnnotationAction(true));
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(true);
      const blockedByUser = yield select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(null);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation where othersMayEdit is turned on should try to acquire the annotation mutex and not allow editing if mutex is not returned as can edit.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
    }));
    const task = startSaga(function* task() {
      yield put(setOthersMayEditForAnnotationAction(true));
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Waiting for saga to update which user is holding the mutex.
      yield take("SET_USER_HOLDING_MUTEX");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(false);
      const blockedByUser = yield select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(blockingUser);
      const isUpdatingCurrentlyAllowed = yield select(
        (state) => state.annotation.isUpdatingCurrentlyAllowed,
      );
      expect(isUpdatingCurrentlyAllowed).toBe(false);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = false should not try to instantly acquire the mutex nor should it be fetched upon proofreading action.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTestingWithRestrictions(context, false, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab = true should not try to instantly acquire the mutex; only after an proofread annotation action.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context, true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab disabled should try to instantly acquire the mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should retry fetching mutex if initial did not work.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    // Configuring annotation to support ad-hoc mutex fetching.
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();

    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen as ad hoc mutex fetching should be active!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    // Block first acquiring mutex try.
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
    }));
    const task = startSaga(function* task() {
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Make proofreading merge to trigger saving and thus mutex fetching. Do not wait till saving is done.
      yield makeProofreadMerge(context, false);
      // Wait for failed mutex fetching requests.
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if saga really tried to get the mutex.
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      // Check that the store is in state of the mutex is still trying to be fetched.
      let hasAnnotationMutex = false;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties(
        hasAnnotationMutex,
        blockingUser,
        isUpdatingCurrentlyAllowed,
      );
      // Wait another round of mutex fetching.
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Now make mutex fetching succeed.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      hasAnnotationMutex = true;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching continuously fetch mutex until save done action is triggered.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    // Configuring annotation to support ad-hoc mutex fetching.
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen as ad hoc mutex fetching should be active!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Manually trigger mutex fetching for ad hoc strategy to have more control in test.
      yield put(ensureHasAnnotationMutexAction(() => {}));
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if saga really tried to get the mutex.
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
      // Wait two more fetching cycles (1 second each in testing env)
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Simulate saving finished so the mutex is released.
      yield put(doneSavingAction());
      yield sleep(100);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      // Check whether the mutex was stored as released.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should not continue after saving of a proofreading action was done.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context, true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
    context.mocks.acquireAnnotationMutex.mockClear();
    // Give time to potentially try to acquire the mutex again.
    await sleep(2000);
    // But there shouldn't be a try to fetch the mutex again.
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should retry fetching the mutex lost once already successfully having the mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      // Manually trigger mutex fetching for ad hoc strategy to have more control in test.
      yield put(ensureHasAnnotationMutexAction(() => {}));
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
      // Now block mutex fetching
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => {
        throw new Error("Simulated network problems.");
      });
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex state in store was adjusted accordingly.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties(hasAnnotationMutex, undefined, isUpdatingCurrentlyAllowed);
      // 2nd retry should still not succeed.
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield assertMutexStoreProperties(hasAnnotationMutex, undefined, isUpdatingCurrentlyAllowed);
      // Make next mutex fetching succeed.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      hasAnnotationMutex = true;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Simulate saving finished so the mutex is released.
      yield put(doneSavingAction());
      yield sleep(100);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
    });
    await task.toPromise();
  });

  const ToolsAllowedInProofreadingModeWithoutLiveCollabSupport = [
    AnnotationTool.SKELETON,
    AnnotationTool.BOUNDING_BOX,
  ];

  describe.each(
    ToolsAllowedInProofreadingModeWithoutLiveCollabSupport,
  )("[With AnnotationTool=%s]:", (annotationToolWithoutLiveCollabSupport) => {
    it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = false and liveCollab enabled should not try to acquire the mutex despite the user switching a non Proofreading Tool ${annotationToolWithoutLiveCollabSupport.id}.`, async (context: WebknossosTestContext) => {
      WkDevFlags.liveCollab = true;
      await setupWebknossosForTestingWithRestrictions(context, false, true, true);
      mockInitialBucketAndAgglomerateData(context);
      // Give mutex saga time to potentially acquire the mutex. This should not happen!
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      Store.dispatch(setToolAction(annotationToolWithoutLiveCollabSupport));
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    });

    it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab enabled should not try to instantly acquire the mutex only after the user switches to a non Proofreading Tool ${annotationToolWithoutLiveCollabSupport.id}.`, async (context: WebknossosTestContext) => {
      WkDevFlags.liveCollab = true;
      await setupWebknossosForTestingWithRestrictions(context, true, true, true);
      mockInitialBucketAndAgglomerateData(context);
      // Give mutex saga time to potentially acquire the mutex. This should not happen!
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      Store.dispatch(setToolAction(annotationToolWithoutLiveCollabSupport));
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    });

    it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab enabled should no longer try to continuously acquire the mutex when switching from ${annotationToolWithoutLiveCollabSupport.id} to Move Tool.`, async (context: WebknossosTestContext) => {
      WkDevFlags.liveCollab = true;
      await setupWebknossosForTestingWithRestrictions(context, true, true, true);
      mockInitialBucketAndAgglomerateData(context);
      // Switch to tool without live collab support.
      Store.dispatch(setToolAction(annotationToolWithoutLiveCollabSupport));
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Switch to move tool which has live collab support.
      Store.dispatch(setToolAction(AnnotationTool.MOVE));
      await sleep(1);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      context.mocks.acquireAnnotationMutex.mockReset();
      context.mocks.releaseAnnotationMutex.mockReset();
      await sleep(1000);
      // Due to move tool being active, the saga should not try to acquire the mutex.
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    });
  });

  const othersMayEditValues = [true, false];
  describe.each(othersMayEditValues)("[With othersMayEdit=%s]:", (othersMayEdit) => {
    it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = ${othersMayEditValues} should ${!othersMayEditValues ? "not " : ""}try to acquire the mutex upon activating a different volume annotation layer.`, async (context: WebknossosTestContext) => {
      WkDevFlags.liveCollab = true;
      await setupWebknossosForTestingWithRestrictions(
        context,
        othersMayEdit,
        true,
        true,
        "multiVolume",
      );
      mockInitialBucketAndAgglomerateData(context);
      // Give mutex saga time to potentially acquire the mutex. This should not happen!
      await sleep(100);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      const volumeTracingId2 = Store.getState().annotation.volumes.at(-1);
      if (!volumeTracingId2) {
        throw new Error("No additional volume tracing found to activate.");
      }
      // Switch to other layer. Saga should, depending on othersMayEdit, try to acquire mutex now as the active layer no longer has an editable mapping and thus no liveCollab support.
      Store.dispatch(updateLayerSettingAction(volumeTracingId2.tracingId, "isDisabled", false));
      await sleep(100);
      if (othersMayEdit) {
        expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      } else {
        expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      }
    });
  });
});

describe("Save Mutex Saga should crash", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga did indeed crash.
    expect(hasRootSagaCrashed()).toBe(true);
    vi.clearAllMocks(); // clears call counts of *all* spies
    WkDevFlags.liveCollab = initialLiveCollab;
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should error when another user obtained mutex due to e.g. too long network outage of user.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTestingWithRestrictions(context, true, true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      // Manually trigger mutex fetching for ad hoc strategy to have more control in test.
      yield put(ensureHasAnnotationMutexAction(() => {}));
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties(hasAnnotationMutex, null, isUpdatingCurrentlyAllowed);
      // Now block mutex fetching; simulate e.g. network error.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => {
        throw new Error("Simulated network problems.");
      });
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex state in store was adjusted accordingly.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties(hasAnnotationMutex, undefined, isUpdatingCurrentlyAllowed);
      // 2nd retry should still not succeed.
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield assertMutexStoreProperties(hasAnnotationMutex, undefined, isUpdatingCurrentlyAllowed);
      // Make next mutex fetching fail as a different user now has the mutex. => Should cause a saga crash.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: false,
        blockedByUser: blockingUser,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield sleep(100);
    });
    await task.toPromise();
  });
});
