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

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  yield* call(ensureWkReady);
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  if (!allowUpdate) {
    return;
  }
  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
  const activeUser = yield* select((state) => state.activeUser);
  const acquireMutexInterval = 1000 * 60;
  const RETRY_COUNT = 12;
  const MUTEX_NOT_ACQUIRED_KEY = "MutexCouldNotBeAcquired";
  const MUTEX_ACQUIRED_KEY = "AnnotationMutexAcquired";
  let isInitialRequest = true;
  let doesHaveMutexFromBeginning = false;
  let doesHaveMutex = false;
  let shallTryAcquireMutex = othersMayEdit;

  function onMutexStateChanged(canEdit: boolean, blockedByUser: APIUserCompact | null | undefined) {
    if (canEdit) {
      Toast.close("MutexCouldNotBeAcquired");
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

  function* tryAcquireMutexContinuously(): Saga<void> {
    while (shallTryAcquireMutex) {
      if (isInitialRequest) {
        yield* put(setAnnotationAllowUpdateAction(false));
      }
      try {
        const { canEdit, blockedByUser } = yield* retry(
          RETRY_COUNT,
          acquireMutexInterval / RETRY_COUNT,
          acquireAnnotationMutex,
          annotationId,
        );
        if (isInitialRequest && canEdit) {
          doesHaveMutexFromBeginning = true;
          // Only set allow update to true in case the first try to get the mutex succeeded.
          yield* put(setAnnotationAllowUpdateAction(true));
        }
        if (!canEdit || !doesHaveMutexFromBeginning) {
          // If the mutex could not be acquired anymore or the user does not have it from the beginning, set allow update to false.
          doesHaveMutexFromBeginning = false;
          yield* put(setAnnotationAllowUpdateAction(false));
        }
        if (canEdit) {
          yield* put(setBlockedByUserAction(activeUser));
        } else {
          yield* put(setBlockedByUserAction(blockedByUser));
        }
        if (canEdit !== doesHaveMutex || isInitialRequest) {
          doesHaveMutex = canEdit;
          onMutexStateChanged(canEdit, blockedByUser);
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
          doesHaveMutexFromBeginning = false;
          if (doesHaveMutex || isInitialRequest) {
            onMutexStateChanged(false, null);
            doesHaveMutex = false;
          }
        }
      }
      isInitialRequest = false;
      yield* call(delay, acquireMutexInterval);
    }
  }
  let runningTryAcquireMutexContinuouslySaga = yield* fork(tryAcquireMutexContinuously);
  function* reactToOthersMayEditChanges({
    othersMayEdit,
  }: SetOthersMayEditForAnnotationAction): Saga<void> {
    shallTryAcquireMutex = othersMayEdit;
    if (shallTryAcquireMutex) {
      if (runningTryAcquireMutexContinuouslySaga != null) {
        yield* cancel(runningTryAcquireMutexContinuouslySaga);
      }
      isInitialRequest = true;
      runningTryAcquireMutexContinuouslySaga = yield* fork(tryAcquireMutexContinuously);
    } else {
      // othersMayEdit was turned off. The user editing it should be able to edit the annotation.
      yield* put(setAnnotationAllowUpdateAction(true));
    }
  }
  yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);
}
