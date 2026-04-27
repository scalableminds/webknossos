import { ColoredLogger, sleep } from "libs/utils";
import { call, put, take } from "redux-saga/effects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { delay } from "typed-redux-saga";
import { restartSagaAction } from "viewer/model/actions/actions";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { subscribeToAnnotationMutexAction } from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  clearAllSubscriptions,
  getMutexLogicState,
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
    console.log("Dispatching restartSagaAction");
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

  // Injects a test subscriber directly into mutexLogicState so that ad-hoc saga
  // will start when switching to Concurrent. Avoids the blocking wait inside
  // subscribeToAnnotationMutex (which waits for SET_IS_MUTEX_ACQUIRED).
  function* injectTestSubscriber(): Saga<void> {
    const state = yield call(getMutexLogicState);
    state.subscribersToMutex[999] = "TestSubscriber";
  }

  it<WebknossosTestContext>("Switching from OwnerOnly to Exclusive should start the continuous mutex saga.", async (context: WebknossosTestContext) => {
    ColoredLogger.logBlue("Test 1");
    // startSaga(rootSaga);

    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true);

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });

      yield put(setCollaborationModeAction("Exclusive"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from OwnerOnly to Concurrent with no subscribers should start no saga.", async (context: WebknossosTestContext) => {
    ColoredLogger.logBlue("Test 2");
    // startSaga(rootSaga);

    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true);

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });

      yield put(setCollaborationModeAction("Concurrent"));
      yield delay(50);

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Exclusive to Concurrent should cancel the continuous mutex saga and start the ad-hoc saga.", async (context: WebknossosTestContext) => {
    // startSaga(rootSaga);
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    // Give the continuous saga time to acquire the mutex
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });

      yield* injectTestSubscriber();
      yield put(setCollaborationModeAction("Concurrent"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Exclusive to OwnerOnly should cancel the continuous mutex saga and release the mutex.", async (context: WebknossosTestContext) => {
    // startSaga(rootSaga);
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true);
    await sleep(100);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();

    const task = startSaga(function* task() {
      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });

      yield put(setCollaborationModeAction("OwnerOnly"));
      // releaseMutex dispatches SET_IS_MUTEX_ACQUIRED(false)
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Concurrent to OwnerOnly should cancel the ad-hoc mutex saga and release the mutex.", async (context: WebknossosTestContext) => {
    // startSaga(rootSaga);
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true);

    const task = startSaga(function* task() {
      // Start ad-hoc saga by injecting a subscriber and dispatching the subscribe action
      yield* injectTestSubscriber();
      yield put(subscribeToAnnotationMutexAction(999, "TestSubscriber"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });

      yield put(setCollaborationModeAction("OwnerOnly"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: false });
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("Switching from Concurrent to Exclusive should cancel the ad-hoc mutex saga and start the continuous saga.", async (context: WebknossosTestContext) => {
    // startSaga(rootSaga);
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true);

    const task = startSaga(function* task() {
      // Start ad-hoc saga by injecting a subscriber and dispatching the subscribe action
      yield* injectTestSubscriber();
      yield put(subscribeToAnnotationMutexAction(999, "TestSubscriber"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: false, adHocIsRunning: true });

      yield put(setCollaborationModeAction("Exclusive"));
      yield take("SET_IS_MUTEX_ACQUIRED");

      yield* assertMutexSagaState({ continuousIsRunning: true, adHocIsRunning: false });
    });
    await task.toPromise();
  });
});
