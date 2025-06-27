import { acquireAnnotationMutex } from "admin/rest_api";
import { Button } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import React from "react";
import { call, cancel, cancelled, delay, fork, put, retry, takeEvery } from "typed-redux-saga";
import {
  type SetIsMutexAcquiredAction,
  type SetOthersMayEditForAnnotationAction,
  setAnnotationAllowUpdateAction,
  setBlockedByUserAction,
  setIsMutexAcquiredAction,
} from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "../ready_sagas";

const MUTEX_NOT_ACQUIRED_KEY = "MutexCouldNotBeAcquired";
const MUTEX_ACQUIRED_KEY = "AnnotationMutexAcquired";
const RETRY_COUNT = 12;
const ACQUIRE_MUTEX_INTERVAL = 1000 * 60;

// todop
const DISABLE_EAGER_MUTEX_ACQUISITION = true;

type MutexLogicState = {
  isInitialRequest: boolean;
};

function* getDoesHaveMutex(): Saga<boolean> {
  return yield* select((state) => state.annotation.isMutexAcquired);
}

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  if (DISABLE_EAGER_MUTEX_ACQUISITION) {
    return;
  }
  const initialAllowUpdate = yield* select(
    (state) => state.annotation.restrictions.initialAllowUpdate,
  );
  if (!initialAllowUpdate) {
    // We are in an read-only annotation.
    return;
  }
  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
  };

  yield* call(ensureWkReady);
  yield* fork(watchMutexStateChangesForNotification, mutexLogicState);

  let runningTryAcquireMutexContinuouslySaga = yield* fork(
    tryAcquireMutexContinuously,
    mutexLogicState,
  );
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
      // othersMayEdit was turned off. The user editing it should be able to edit the annotation.
      // let's check that owner === activeUser, anyway.
      const owner = yield* select((storeState) => storeState.annotation.owner);
      const activeUser = yield* select((state) => state.activeUser);
      if (activeUser && owner?.id === activeUser?.id) {
        yield* put(setAnnotationAllowUpdateAction(true));
      }
    }
  }
  yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);
}

function* tryAcquireMutexContinuously(mutexLogicState: MutexLogicState): Saga<void> {
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  const activeUser = yield* select((state) => state.activeUser);
  mutexLogicState.isInitialRequest = true;

  // We can simply use an infinite loop here, because the saga will be cancelled by
  // reactToOthersMayEditChanges when othersMayEdit is set to false.
  while (true) {
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
      const wasCanceled = yield* cancelled();
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
