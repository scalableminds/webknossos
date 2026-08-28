import { call, put, take } from "redux-saga/effects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { delay } from "typed-redux-saga";
import { restartSagaAction } from "viewer/model/actions/actions";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import type { SetIsMutexAcquiredAction } from "viewer/model/actions/save_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  clearAllSubscriptions,
  getMutexLogicState,
  subscribeToAnnotationMutex,
} from "viewer/model/sagas/saving/save_mutex_saga";
import { startSaga } from "viewer/store";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Save Mutex Saga collaboration mode switching", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    const task = startSaga(function* task() {
      yield call(clearAllSubscriptions);
      yield put(restartSagaAction());
    });
    await task.toPromise();
    expect(hasRootSagaCrashed()).toBe(false);
    vi.clearAllMocks();
  });

  function* assertMutexSagaState({
    continuousIsRunning,
    adHocIsRunning,
  }: {
    continuousIsRunning: boolean;
    adHocIsRunning: boolean;
  }): Saga<any> {
    const state = yield call(getMutexLogicState);
    if (continuousIsRunning) {
      expect(state.runningContinuousMutexAcquiringSaga).not.toBeNull();
    } else {
      expect(state.runningContinuousMutexAcquiringSaga).toBeNull();
    }
    if (adHocIsRunning) {
      expect(state.runningAdHocMutexAcquiringSaga).not.toBeNull();
    } else {
      expect(state.runningAdHocMutexAcquiringSaga).toBeNull();
    }
    return state;
  }

  function* assertSetIsMutexAcquiredAction(expectedIsAcquired: boolean) {
    const action = (yield take("SET_IS_MUTEX_ACQUIRED")) as SetIsMutexAcquiredAction;
    expect(action.isMutexAcquired).toEqual(expectedIsAcquired);
  }

  function* assertIsMutexAcquired() {
    const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
    expect(hasMutex).toBeTruthy();
  }

  /*
   * Tests for:
   *   OwnerOnly -> {Exclusive, Concurrent}
   */

  it<WebknossosTestContext>("Switching from OwnerOnly to Exclusive should start the continuous mutex saga.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true);

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });

      yield put(setCollaborationModeAction("Exclusive"));
      yield* assertSetIsMutexAcquiredAction(true);

      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from OwnerOnly to Concurrent with no subscribers should start no saga.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true);

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });

      yield put(setCollaborationModeAction("Concurrent"));

      // Sleep to really ensure that no saga was started
      yield delay(50);
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from OwnerOnly to Concurrent with one subscriber should start adhoc saga.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true);

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });

      yield put(setCollaborationModeAction("Concurrent"));
      yield call(subscribeToAnnotationMutex, "someSubscriber");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });
    });
    await task.toPromise();
  });

  /*
   * Tests for:
   *   Exclusive -> {Concurrent, OwnerOnly}
   */
  it<WebknossosTestContext>("Switching from Exclusive to Concurrent should cancel the continuous mutex saga and start the ad-hoc saga.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });

      const release = yield call(subscribeToAnnotationMutex, "someSubscriber");
      yield put(setCollaborationModeAction("Concurrent"));
      yield* assertSetIsMutexAcquiredAction(true);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });

      yield call(release);
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Exclusive to OwnerOnly should cancel the continuous mutex saga and release the mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });

      yield put(setCollaborationModeAction("OwnerOnly"));
      yield* assertSetIsMutexAcquiredAction(false);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  /*
   * Tests for:
   *   Concurrent -> {OwnerOnly, Exclusive}
   */
  it<WebknossosTestContext>("Switching from Concurrent to OwnerOnly should cancel the ad-hoc mutex saga and release the mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true);

    const task = startSaga(function* task() {
      yield call(subscribeToAnnotationMutex, "someSubscriber");
      yield* assertSetIsMutexAcquiredAction(true);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });

      yield put(setCollaborationModeAction("OwnerOnly"));
      yield* assertSetIsMutexAcquiredAction(false);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Concurrent to Exclusive should cancel the ad-hoc mutex saga and start the continuous saga.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true);

    const task = startSaga(function* task() {
      yield call(subscribeToAnnotationMutex, "someSubscriber");
      yield* assertSetIsMutexAcquiredAction(true);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });

      yield put(setCollaborationModeAction("Exclusive"));
      // The mutex was already acquired and should still be acquired. Therefore, we don't
      // use assertSetIsMutexAcquiredAction (which waits for an action), but access the store directly.
      // To be extra safe, we wait a bit to give possibly wrong actions/sagas time to do change the store.
      yield* delay(50);
      yield* assertIsMutexAcquired();

      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });
    });
    await task.toPromise();
  });
});
