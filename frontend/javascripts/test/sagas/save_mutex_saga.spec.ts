import { sleep } from "libs/utils";
import { call, put, take } from "redux-saga/effects";
import { powerOrga } from "test/fixtures/dummy_organization";
import {
  setupWebknossosForTesting,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { delay } from "typed-redux-saga";
import type { APIUserCompact } from "types/api_types";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { restartSagaAction } from "viewer/model/actions/actions";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import { disableSavingAction } from "viewer/model/actions/save_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  clearAllSubscriptions,
  getMutexLogicState,
  subscribeToAnnotationMutex,
} from "viewer/model/sagas/saving/save_mutex_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPositionForSegmentId,
  mockInitialBucketAndAgglomerateData,
  operationFinished,
  operationStarted,
} from "./proofreading/proofreading_test_utils";

const blockingUser: APIUserCompact = { firstName: "Sample", lastName: "User", id: "1111" };

async function makeProofreadMerge(
  context: WebknossosTestContext,
  waitTillFinished: boolean,
): Promise<void> {
  const { annotation } = Store.getState();
  const { tracingId } = annotation.volumes[0];

  const task = startSaga(function* () {
    yield put(setActiveOrganizationAction(powerOrga));
    yield put(setZoomStepAction(0.3));
    const currentMag = yield* select((state) => getCurrentMag(state, tracingId));
    expect(currentMag).toEqual([1, 1, 1]);
    yield put(setToolAction(AnnotationTool.PROOFREAD));

    // Read data from the 0,0,0 bucket so that it is in memory (important because the mapping
    // is only maintained for loaded buckets). => Forces loading of mapping.
    const valueAt444 = yield call(() => context.api.data.getDataValue(tracingId, [4, 4, 4], 0));
    expect(valueAt444).toBe(4);
    yield take("SET_MAPPING");
    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
    yield put(setActiveCellAction(1));
    // Execute the actual merge and wait for the finished mapping.
    yield put(proofreadMergeAction(getPositionForSegmentId(4), 4));
    yield take(operationStarted("proofreading"));
    if (waitTillFinished) {
      // Wait for proofreading operation to start and then finish to ensure saving of the whole saga is done.
      yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");
      yield take(operationFinished("proofreading"));
    }
  });
  await task.toPromise();
}

function* assertMutexStoreProperties({
  hasAnnotationMutex,
  blockingUser,
  isUpdatingCurrentlyAllowed,
}: {
  hasAnnotationMutex: boolean;
  blockingUser: APIUserCompact | null | undefined;
  isUpdatingCurrentlyAllowed: boolean;
}): Saga<void> {
  const hasAnnotationMutexInStore = yield* select(
    (state) => state.save.mutexState.hasAnnotationMutex,
  );
  expect(hasAnnotationMutexInStore).toBe(hasAnnotationMutex);
  const blockedByUserInStore = yield* select((state) => state.save.mutexState.blockedByUser);
  expect(blockedByUserInStore).toBe(blockingUser);
  const isUpdatingCurrentlyAllowedInStore = yield* select(
    (state) => state.annotation.isUpdatingCurrentlyAllowed,
  );
  expect(isUpdatingCurrentlyAllowedInStore).toBe(isUpdatingCurrentlyAllowed);
}

describe("Save Mutex Saga", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Not all tests clean up their detached ad hoc mutex fetching sagas.
    // Thus, we need to manually clear them here.
    const task = startSaga(function* task() {
      yield call(clearAllSubscriptions);
    });
    await task.toPromise();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
    Store.dispatch(restartSagaAction());
    vi.clearAllMocks(); // clears call counts of *all* spies
  });

  it<WebknossosTestContext>("clearAllSubscriptions should clear all ad hoc mutex subscriptions.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      const _unsubscribe = yield call(subscribeToAnnotationMutex, "Test");
      yield delay(1000);
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      yield call(clearAllSubscriptions);
      yield delay(10);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      context.mocks.acquireAnnotationMutex.mockClear();
      context.mocks.releaseAnnotationMutex.mockClear();
      yield delay(1000);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("calling unsubscribeFromAnnotationMutexSaga multiple times should not result in an error.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      const unsubscribe = yield call(subscribeToAnnotationMutex, "Test");
      yield delay(1000);
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      yield call(unsubscribe);
      yield delay(10);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      context.mocks.acquireAnnotationMutex.mockClear();
      context.mocks.releaseAnnotationMutex.mockClear();
      yield call(unsubscribe);
      yield call(unsubscribe);
      yield call(unsubscribe);
      yield delay(1000);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    });
    await task.toPromise();
  });

  // Properties that can influence whether mutex acquisition is called are:
  // - othersMayEdit
  // - isUpdatingCurrentlyAllowed
  // - activeTool
  // - activeVolumeTracing
  it<WebknossosTestContext>("An annotation with allowUpdate = false and collaborationMode = OwnerOnly should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", false);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = false and collaborationMode = Concurrent should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", false);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = true and collaborationMode = OwnerOnly should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", false);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and collaborationMode = Concurrent should not try to acquire the annotation mutex (regardless of no editable mapping being).", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and collaborationMode = Concurrent should not try to acquire the annotation mutex (regardless of active editable mapping).", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and collaborationMode = Exclusive should try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation where collaborationMode==Exclusive should try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      yield put(setCollaborationModeAction("Exclusive"));
      const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield* select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(true);
      const blockedByUser = yield* select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(null);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("After the first successful mutex acquisition, editing should remain allowed during subsequent refreshes (regression test).", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    // After setup, the initial mutex acquisition has already completed.
    expect(Store.getState().annotation.isUpdatingCurrentlyAllowed).toBe(true);
    const task = startSaga(function* task() {
      // SET_USER_HOLDING_MUTEX is dispatched on every loop iteration of tryAcquireMutexContinuously.
      // The initial dispatch happened during setup, so this take waits for the second iteration.
      yield take("SET_USER_HOLDING_MUTEX");
      // Before the fix, isUpdatingCurrentlyAllowed was incorrectly set to false at the start of
      // every non-initial loop iteration and never restored (setIsUpdatingAnnotationCurrentlyAllowedAction
      // is only called when isInitialRequest || !canEdit, both false when we already hold the mutex).
      yield assertMutexStoreProperties({
        hasAnnotationMutex: true,
        blockingUser: null,
        isUpdatingCurrentlyAllowed: true,
      });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("After the first mutex acquisition was unsuccessful, editing should remain disabled even when the second mutex acquisition succeeds.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(context, "hybrid");
    // Mock fails on the first attempt so we can observe what happens when it later succeeds.
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
      blockedBySessionId: null,
    }));
    const task = startSaga(function* task() {
      yield put(setCollaborationModeAction("Exclusive"));
      // Wait for the initial (failed) acquisition.
      yield take("SET_USER_HOLDING_MUTEX");
      yield assertMutexStoreProperties({
        hasAnnotationMutex: false,
        blockingUser: blockingUser,
        isUpdatingCurrentlyAllowed: false,
      });
      // Let the next acquisition succeed.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
        blockedBySessionId: null,
      }));
      // SET_IS_MUTEX_ACQUIRED fires when hasAnnotationMutex changes (false → true).
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Editing must remain disabled — the user has to refresh the page.
      // setIsUpdatingAnnotationCurrentlyAllowedAction is only dispatched when
      // isInitialRequest || !canEdit; on subsequent successful refreshes both are false,
      // so the false set by the initial failure is never restored.
      yield assertMutexStoreProperties({
        hasAnnotationMutex: true,
        blockingUser: null,
        isUpdatingCurrentlyAllowed: false,
      });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation where othersMayEdit is turned on should try to acquire the annotation mutex and not allow editing if mutex is not returned as can edit.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
      blockedBySessionId: null,
    }));
    const task = startSaga(function* task() {
      yield put(setCollaborationModeAction("Exclusive"));
      const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Waiting for saga to update which user is holding the mutex.
      yield take("SET_USER_HOLDING_MUTEX");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield* select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(false);
      const blockedByUser = yield* select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(blockingUser);
      const isUpdatingCurrentlyAllowed = yield* select(
        (state) => state.annotation.isUpdatingCurrentlyAllowed,
      );
      expect(isUpdatingCurrentlyAllowed).toBe(false);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = false should not try to instantly acquire the mutex nor should it be fetched upon proofreading action.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context, true);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with collaborationMode = Concurrent should not try to instantly acquire the mutex; only after an proofread annotation action.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context, true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with collaborationMode = Exclusive should try to instantly acquire the mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should retry fetching mutex if initial did not work.", async (context: WebknossosTestContext) => {
    // Configuring annotation to support ad-hoc mutex fetching.
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();

    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen as ad hoc mutex fetching should be active!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    // Block first acquiring mutex try.
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
      blockedBySessionId: null,
    }));
    const task = startSaga(function* task() {
      const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
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
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser,
        isUpdatingCurrentlyAllowed,
      });
      // Wait another round of mutex fetching.
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Now make mutex fetching succeed.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
        blockedBySessionId: null,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      hasAnnotationMutex = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching continuously fetch mutex until no subscriber is left - simple single subscriber.", async (context: WebknossosTestContext) => {
    // Configuring annotation to support ad-hoc mutex fetching.
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen as ad hoc mutex fetching should be active!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Request the annotation mutex.
      const unsubscribeFromMutex = yield call(subscribeToAnnotationMutex, "Test");
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if saga really tried to get the mutex.
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
      // Wait two more fetching cycles (1 second each in testing env)
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Simulate saving finished so the mutex is released.
      yield call(unsubscribeFromMutex);
      yield sleep(100);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      // Check whether the mutex was stored as released.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching continuously fetch mutex until No subscriber is left - complex multiple subscriber.", async (context: WebknossosTestContext) => {
    // Configuring annotation to support ad-hoc mutex fetching.
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen as ad hoc mutex fetching should be active!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Request the annotation mutex multiple times.
      const unsubscribeFromMutex1 = yield call(subscribeToAnnotationMutex, "Test");
      const unsubscribeFromMutex2 = yield call(subscribeToAnnotationMutex, "Test");
      const unsubscribeFromMutex3 = yield call(subscribeToAnnotationMutex, "Test");
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if saga really tried to get the mutex.
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
      // Wait two more fetching cycles (1 second each in testing env)
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Release the mutex subscriptions one by one. Only after the last one is unsubscribed, the mutex should be released.
      yield call(unsubscribeFromMutex1);
      yield sleep(10);
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      yield call(unsubscribeFromMutex2);
      yield sleep(10);
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      yield call(unsubscribeFromMutex3);
      yield sleep(10);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
      // Check whether the mutex was stored as released.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Ad-hoc mutex fetching should not continue after saving of a proofreading action was done.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
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
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      // Manually trigger mutex fetching for ad hoc strategy to have more control in test.
      const unsubscribeFromMutex = yield call(subscribeToAnnotationMutex, "Test");
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
      // Now block mutex fetching
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => {
        throw new Error("Expected Error: Simulated network problems.");
      });
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex state in store was adjusted accordingly.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: undefined,
        isUpdatingCurrentlyAllowed,
      });
      // 2nd retry should still not succeed.
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: undefined,
        isUpdatingCurrentlyAllowed,
      });
      // Make next mutex fetching succeed.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
        blockedBySessionId: null,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      hasAnnotationMutex = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
      expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
      // Simulate saving finished so the mutex is released.
      yield call(unsubscribeFromMutex);
      yield sleep(100);
      expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
    });
    await task.toPromise();
  });

  describe("When disableSavingAction is dispatched", () => {
    describe.each([
      { collaborationMode: "Exclusive" as const },
      { collaborationMode: "Concurrent" as const },
    ])("collaborationMode=$collaborationMode", ({ collaborationMode }) => {
      it<WebknossosTestContext>("the mutex acquiring saga should be cancelled", async (context: WebknossosTestContext) => {
        await setupWebknossosForTestingWithRestrictions(context, collaborationMode, true);
        const task = startSaga(function* task() {
          // subscribeToAnnotationMutex blocks until the mutex is acquired.
          // For Exclusive, the continuous saga is already acquiring; for Concurrent,
          // subscribing triggers the ad-hoc saga.
          yield call(subscribeToAnnotationMutex, "Test");
          expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
          context.mocks.acquireAnnotationMutex.mockClear();
          Store.dispatch(disableSavingAction());
          yield sleep(200);
          context.mocks.acquireAnnotationMutex.mockClear();
          // Wait longer than one acquire interval (1s in test mode) to confirm no retries.
          yield sleep(2000);
          expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
        });
        await task.toPromise();
      });

      it<WebknossosTestContext>("a held mutex should be released", async (context: WebknossosTestContext) => {
        await setupWebknossosForTestingWithRestrictions(context, collaborationMode, true);
        const task = startSaga(function* task() {
          yield call(subscribeToAnnotationMutex, "Test");
          expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
          expect(context.mocks.releaseAnnotationMutex).not.toHaveBeenCalled();
          Store.dispatch(disableSavingAction());
          yield sleep(200);
          expect(context.mocks.releaseAnnotationMutex).toHaveBeenCalled();
          yield assertMutexStoreProperties({
            hasAnnotationMutex: false,
            blockingUser: null,
            isUpdatingCurrentlyAllowed: true,
          });
        });
        await task.toPromise();
      });

      it<WebknossosTestContext>("the saga should not restart after a collaboration mode change following disableSavingAction", async (context: WebknossosTestContext) => {
        await setupWebknossosForTestingWithRestrictions(context, collaborationMode, true);
        const task = startSaga(function* task() {
          yield call(subscribeToAnnotationMutex, "Test");
          Store.dispatch(disableSavingAction());
          yield sleep(200);
          context.mocks.acquireAnnotationMutex.mockClear();
          // Switching collaboration mode would normally restart the acquiring saga.
          yield put(setCollaborationModeAction("Exclusive"));
          yield put(setCollaborationModeAction("Concurrent"));
          yield sleep(2000);
          expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
        });
        await task.toPromise();
      });
    });
  });
});

describe("Save Mutex Saga should crash", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga did crash as the tests below should make the save mutex acquisition saga crash.
    expect(hasRootSagaCrashed()).toBe(true);
    vi.clearAllMocks(); // clears call counts of *all* spies
  });

  it<WebknossosTestContext>("The spawned ad-hoc mutex fetching saga should error when another user obtained mutex due to e.g. too long network outage of user.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, true);
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      // Manually trigger mutex fetching for ad hoc strategy to have more control in test.
      yield call(subscribeToAnnotationMutex, "Test");
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex was successfully received.
      let hasAnnotationMutex = true;
      let isUpdatingCurrentlyAllowed = true;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: null,
        isUpdatingCurrentlyAllowed,
      });
      // Now block mutex fetching; simulate e.g. network error.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => {
        throw new Error("Simulated network problems.");
      });
      yield take("SET_IS_MUTEX_ACQUIRED");
      // Check if mutex state in store was adjusted accordingly.
      hasAnnotationMutex = false;
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: undefined,
        isUpdatingCurrentlyAllowed,
      });
      // 2nd retry should still not succeed.
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield assertMutexStoreProperties({
        hasAnnotationMutex,
        blockingUser: undefined,
        isUpdatingCurrentlyAllowed,
      });
      // Make next mutex fetching fail as a different user now has the mutex. => Should cause a saga crash.
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: false,
        blockedByUser: blockingUser,
        blockedBySessionId: null,
      }));
      yield take("SET_IS_MUTEX_ACQUIRED");
      yield sleep(100);
      // Checking whether the spawned mutex fetching saga did indeed crash.
      const annotationMutexLogicState = yield call(getMutexLogicState);
      expect(annotationMutexLogicState.runningAdHocMutexAcquiringSaga?.error()).toBeDefined();
    });
    await task.toPromise();
  });
});
