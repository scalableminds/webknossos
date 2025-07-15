import { acquireAnnotationMutex } from "admin/rest_api";
import { Button } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import React from "react";
import {
  type FixedTask,
  call,
  cancel,
  cancelled,
  delay,
  fork,
  put,
  race,
  retry,
  take,
  takeEvery,
} from "typed-redux-saga";
import {
  type SetIsMutexAcquiredAction,
  type SetOthersMayEditForAnnotationAction,
  setAnnotationAllowUpdateAction,
  setBlockedByUserAction,
  setIsMutexAcquiredAction,
} from "viewer/model/actions/annotation_actions";
import type { EnsureMaySaveNowAction } from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "../ready_sagas";

// Also refer to application.conf where annotation.mutex.expiryTime is defined
// (typically, 2 minutes).

const MUTEX_NOT_ACQUIRED_KEY = "MutexCouldNotBeAcquired";
const MUTEX_ACQUIRED_KEY = "AnnotationMutexAcquired";
const ACQUIRE_MUTEX_INTERVAL = 1000 * 60;
const RETRY_COUNT = 12; // 12 retries with 60/12=5 seconds backup delay

// todop
const DISABLE_EAGER_MUTEX_ACQUISITION = true;

type MutexLogicState = {
  isInitialRequest: boolean;
};

function* getDoesHaveMutex(): Saga<boolean> {
  return yield* select((state) => state.annotation.isMutexAcquired);
}

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  /*
   * This saga is directly called by the root saga.
   *
   */
  yield* call(ensureWkReady);
  const initialAllowUpdate = yield* select(
    (state) => state.annotation.restrictions.initialAllowUpdate,
  );
  if (!initialAllowUpdate) {
    // We are in an read-only annotation. There's no point in acquiring mutexes.
    console.log("exit mutex saga");
    return;
  }
  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
  };

  yield* fork(watchMutexStateChangesForNotification, mutexLogicState);

  let runningTryAcquireMutexContinuouslySaga: FixedTask<void> | null;

  function* reactToOthersMayEditChanges({
    othersMayEdit,
  }: SetOthersMayEditForAnnotationAction): Saga<void> {
    if (othersMayEdit) {
      if (runningTryAcquireMutexContinuouslySaga != null) {
        yield* cancel(runningTryAcquireMutexContinuouslySaga);
      }
      runningTryAcquireMutexContinuouslySaga = yield* fork(
        tryAcquireMutexContinuously,
        mutexLogicState,
      );
    } else {
      // othersMayEdit was turned off by the activeUser. Since this is only
      // allowed by the owner, they should be able to edit the annotation, too.
      // Still, let's check that owner === activeUser to be extra safe.
      const owner = yield* select((storeState) => storeState.annotation.owner);
      const activeUser = yield* select((state) => state.activeUser);
      if (activeUser && owner?.id === activeUser?.id) {
        yield* put(setAnnotationAllowUpdateAction(true));
      }
    }
  }
  yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);

  if (DISABLE_EAGER_MUTEX_ACQUISITION) {
    // console.log("listening to all ENSURE_MAY_SAVE_NOW");
    yield* takeEvery("ENSURE_MAY_SAVE_NOW", resolveEnsureMaySaveNowActions);
    while (true) {
      // console.log("taking ENSURE_MAY_SAVE_NOW");
      yield* take("ENSURE_MAY_SAVE_NOW");
      // console.log("took ENSURE_MAY_SAVE_NOW");
      const { doneSaving } = yield race({
        tryAcquireMutexContinuously: fork(tryAcquireMutexContinuously, mutexLogicState),
        doneSaving: take("DONE_SAVING"),
      });
      if (doneSaving) {
        yield call(releaseMutex);
      }
    }
  } else {
    runningTryAcquireMutexContinuouslySaga = yield* fork(
      tryAcquireMutexContinuously,
      mutexLogicState,
    );
  }
}

function* resolveEnsureMaySaveNowActions(action: EnsureMaySaveNowAction) {
  /*
   * For each EnsureMaySaveNowAction wait until we have the mutex. Then call
   * the callback.
   */
  while (true) {
    const doesHaveMutex = yield* select(getDoesHaveMutex);
    if (doesHaveMutex) {
      action.callback();
      return;
    }
    yield* take("SET_BLOCKED_BY_USER");
  }
}

function* tryAcquireMutexContinuously(mutexLogicState: MutexLogicState): Saga<never> {
  /*
   * Try to acquire mutex indefinitely (saga can be cancelled from the outside with cancel or
   * race).
   */
  console.log("started tryAcquireMutexContinuously");
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  const activeUser = yield* select((state) => state.activeUser);
  mutexLogicState.isInitialRequest = true;

  // We can simply use an infinite loop here, because the saga will be cancelled by
  // reactToOthersMayEditChanges when othersMayEdit is set to false.
  while (true) {
    console.log("tryAcquireMutexContinuously loop");
    const blockedByUser = yield* select((state) => state.annotation.blockedByUser);
    if (blockedByUser == null || blockedByUser.id !== activeUser?.id) {
      // If the annotation is currently not blocked by the active user,
      // we immediately disallow updating the annotation.
      yield* put(setAnnotationAllowUpdateAction(false));
    }
    try {
      const { canEdit, blockedByUser } = yield* retry(
        RETRY_COUNT,
        ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
        acquireAnnotationMutex,
        annotationId,
      );
      yield* put(setAnnotationAllowUpdateAction(canEdit));
      yield* put(setBlockedByUserAction(canEdit ? activeUser : blockedByUser));

      if (canEdit !== (yield* call(getDoesHaveMutex))) {
        // Only dispatch the action if it changes the store to avoid
        // unnecessary notifications.
        yield* put(setIsMutexAcquiredAction(canEdit));
      }
    } catch (error) {
      if (process.env.IS_TESTING) {
        // In unit tests, that explicitly control this generator function,
        // the console.error after the next yield won't be printed, because
        // test assertions on the yield will already throw.
        // Therefore, we also print the error in the test context.
        console.error("Error while trying to acquire mutex:", error);
      }
      // todop: I think this needs to happen in a finally block?
      const wasCanceled = yield* cancelled();
      console.log("wasCanceled", wasCanceled);
      if (!wasCanceled) {
        console.error("Error while trying to acquire mutex.", error);
        yield* put(setBlockedByUserAction(undefined));
        yield* put(setAnnotationAllowUpdateAction(false));
        if (yield* call(getDoesHaveMutex)) {
          yield* put(setIsMutexAcquiredAction(false));
        }
      }
    }
    mutexLogicState.isInitialRequest = false;
    yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
  }
}

function* watchMutexStateChangesForNotification(mutexLogicState: MutexLogicState): Saga<void> {
  yield* takeEvery(
    "SET_IS_MUTEX_ACQUIRED",
    function* ({ isMutexAcquired }: SetIsMutexAcquiredAction) {
      if (isMutexAcquired) {
        Toast.close(MUTEX_NOT_ACQUIRED_KEY);
        if (!mutexLogicState.isInitialRequest) {
          const message = (
            <React.Fragment>
              {messages["annotation.acquiringMutexSucceeded"]}" "
              <Button onClick={() => location.reload()}>Reload the annotation</Button>
            </React.Fragment>
          );
          Toast.success(message, { sticky: true, key: MUTEX_ACQUIRED_KEY });
        }
      } else {
        Toast.close(MUTEX_ACQUIRED_KEY);
        const blockedByUser = yield* select((state) => state.annotation.blockedByUser);
        const message =
          blockedByUser != null
            ? messages["annotation.acquiringMutexFailed"]({
                userName: `${blockedByUser.firstName} ${blockedByUser.lastName}`,
              })
            : messages["annotation.acquiringMutexFailed.noUser"];
        Toast.warning(message, { sticky: true, key: MUTEX_NOT_ACQUIRED_KEY });
      }
      mutexLogicState.isInitialRequest = false;
    },
  );
}

function* releaseMutex() {
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  yield* retry(
    RETRY_COUNT,
    ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
    acquireAnnotationMutex,
    annotationId,
  );
  yield* put(setAnnotationAllowUpdateAction(true));
  yield* put(setBlockedByUserAction(null));
}
