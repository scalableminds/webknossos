import { acquireAnnotationMutex } from "admin/rest_api";
import { Button } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import React from "react";
import { call, cancel, cancelled, delay, fork, put, retry, takeEvery } from "typed-redux-saga";
import type { APIUserCompact } from "types/api_types";
import {
  type SetOthersMayEditForAnnotationAction,
  setAnnotationAllowUpdateAction,
  setBlockedByUserAction,
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
  doesHaveMutexFromBeginning: boolean;
  doesHaveMutex: boolean;
  shallTryAcquireMutex: boolean;
};

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  yield* call(ensureWkReady);
  if (DISABLE_EAGER_MUTEX_ACQUISITION) {
    return;
  }
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) {
    return;
  }
  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);

  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
    doesHaveMutexFromBeginning: false,
    doesHaveMutex: false,
    shallTryAcquireMutex: othersMayEdit,
  };

  let runningTryAcquireMutexContinuouslySaga = yield* fork(
    tryAcquireMutexContinuously,
    mutexLogicState,
  );
  function* reactToOthersMayEditChanges({
    othersMayEdit,
  }: SetOthersMayEditForAnnotationAction): Saga<void> {
    mutexLogicState.shallTryAcquireMutex = othersMayEdit;
    if (mutexLogicState.shallTryAcquireMutex) {
      if (runningTryAcquireMutexContinuouslySaga != null) {
        yield* cancel(runningTryAcquireMutexContinuouslySaga);
      }
      mutexLogicState.isInitialRequest = true;
      runningTryAcquireMutexContinuouslySaga = yield* fork(
        tryAcquireMutexContinuously,
        mutexLogicState,
      );
    } else {
      // othersMayEdit was turned off. The user editing it should be able to edit the annotation.
      yield* put(setAnnotationAllowUpdateAction(true));
    }
  }
  yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);
}

function* tryAcquireMutexContinuously(mutexLogicState: MutexLogicState): Saga<void> {
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  const activeUser = yield* select((state) => state.activeUser);

  while (mutexLogicState.shallTryAcquireMutex) {
    if (mutexLogicState.isInitialRequest) {
      yield* put(setAnnotationAllowUpdateAction(false));
    }
    try {
      const { canEdit, blockedByUser } = yield* retry(
        RETRY_COUNT,
        ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
        acquireAnnotationMutex,
        annotationId,
      );
      if (mutexLogicState.isInitialRequest && canEdit) {
        mutexLogicState.doesHaveMutexFromBeginning = true;
        // Only set allow update to true in case the first try to get the mutex succeeded.
        yield* put(setAnnotationAllowUpdateAction(true));
      }
      if (!canEdit || !mutexLogicState.doesHaveMutexFromBeginning) {
        // If the mutex could not be acquired anymore or the user does not have it from the beginning, set allow update to false.
        mutexLogicState.doesHaveMutexFromBeginning = false;
        yield* put(setAnnotationAllowUpdateAction(false));
      }
      if (canEdit) {
        yield* put(setBlockedByUserAction(activeUser));
      } else {
        yield* put(setBlockedByUserAction(blockedByUser));
      }
      if (canEdit !== mutexLogicState.doesHaveMutex || mutexLogicState.isInitialRequest) {
        mutexLogicState.doesHaveMutex = canEdit;
        onMutexStateChanged(mutexLogicState.isInitialRequest, canEdit, blockedByUser);
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
        mutexLogicState.doesHaveMutexFromBeginning = false;
        if (mutexLogicState.doesHaveMutex || mutexLogicState.isInitialRequest) {
          onMutexStateChanged(mutexLogicState.isInitialRequest, false, null);
          mutexLogicState.doesHaveMutex = false;
        }
      }
    }
    mutexLogicState.isInitialRequest = false;
    yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
  }
}

// todop: this should automatically react to store changes / actions. there could be a "SET_MUTEX_INFO" action
function onMutexStateChanged(
  isInitialRequest: boolean,
  canEdit: boolean,
  blockedByUser: APIUserCompact | null | undefined,
) {
  if (canEdit) {
    Toast.close(MUTEX_NOT_ACQUIRED_KEY);
    if (!isInitialRequest) {
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
    const message =
      blockedByUser != null
        ? messages["annotation.acquiringMutexFailed"]({
            userName: `${blockedByUser.firstName} ${blockedByUser.lastName}`,
          })
        : messages["annotation.acquiringMutexFailed.noUser"];
    Toast.warning(message, { sticky: true, key: MUTEX_NOT_ACQUIRED_KEY });
  }
}
