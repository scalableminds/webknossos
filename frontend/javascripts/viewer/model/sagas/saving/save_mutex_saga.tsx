import {
  acquireAnnotationMutex,
  releaseAnnotationMutex,
  releaseAnnotationMutexWithBeacon,
} from "admin/rest_api";
import { Button } from "antd";
import { TAB_SESSION_ID } from "libs/tab_session_id";
import Toast from "libs/toast";
import messages from "messages";
import {
  call,
  cancel,
  cancelled,
  delay,
  type FixedTask,
  fork,
  put,
  race,
  retry,
  take,
  takeEvery,
} from "typed-redux-saga";
import { isAnnotationEditableByNonOwners } from "viewer/model/accessors/annotation_accessor";
import {
  type SetCollaborationModeAction,
  setIsUpdatingAnnotationCurrentlyAllowedAction,
} from "viewer/model/actions/annotation_actions";
import {
  type SetIsMutexAcquiredAction,
  type SubscribeToAnnotationMutexAction,
  setIsMutexAcquiredAction,
  setUserHoldingMutexAction,
  subscribeToAnnotationMutexAction,
  unsubscribeFromAnnotationMutexAction,
} from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { spawnUntilCanceled } from "viewer/model/sagas/saga_helpers";
import { ensureWkInitialized } from "../ready_sagas";

// Also refer to application.conf where annotation.mutex.expiryTime is defined
// (typically, 2 minutes).

const MUTEX_NOT_ACQUIRED_KEY = "MutexCouldNotBeAcquired";
const MUTEX_ACQUIRED_KEY = "AnnotationMutexAcquired";
const MUTEX_BLOCKED_FOR_TOO_LONG_KEY = "MutexBlockedForTooLong";
const ACQUIRE_MUTEX_INTERVAL = import.meta.env.MODE === "test" ? 1 * 1000 : 60 * 1000;
const DELAY_AFTER_FAILED_MUTEX_FETCH = import.meta.env.MODE === "test" ? 1 * 1000 : 10 * 1000;
const RETRY_COUNT = 20; // 12 retries with 60/12=5 seconds backup delay
const INITIAL_BACKOFF_TIME = 750;
const BACKOFF_TIME_MULTIPLIER = 1.2;
const BACKOFF_JITTER_LOWER_PERCENT = 0.0;
const MAX_AD_HOC_RETRY_TIME = 30 * 1000;
const BACKOFF_JITTER_UPPER_PERCENT = 0.15;
const MAX_RELEASE_RETRY_INTERVAL = 30 * 1000;

export enum MutexFetchingStrategy {
  AdHoc = "AdHoc",
  Continuously = "Continuously",
}

type MutexLogicState = {
  isInitialRequest: boolean;
  fetchingStrategy: MutexFetchingStrategy;
  // runningContinuousMutexAcquiringSaga is only non-null in collaborationMode=Exclusive.
  runningContinuousMutexAcquiringSaga: FixedTask<void> | null;
  // runningAdHocMutexAcquiringSaga is only non-null in collaborationMode=Concurrent when
  // a mutex is currently needed.
  runningAdHocMutexAcquiringSaga: FixedTask<void> | null;
  subscribersToMutex: Record<number, string>; // Mapping from self maintained id to caller id.
};

function* getDoesHaveMutex(): Saga<boolean> {
  return yield* select((state) => state.save.mutexState.hasAnnotationMutex);
}

export function* getCurrentMutexFetchingStrategy(): Saga<MutexFetchingStrategy> {
  let fetchingStrategy = MutexFetchingStrategy.Continuously;
  const collaborationMode = yield* select((state) => state.annotation.collaborationMode);
  if (collaborationMode === "Concurrent") {
    // The active annotation is currently in proofreading state. Thus, having the mutex only on save demand works in regards to the current milestone.
    fetchingStrategy = MutexFetchingStrategy.AdHoc;
  }
  return fetchingStrategy;
}

function* determineInitialMutexLogicState(): Saga<MutexLogicState> {
  const fetchingStrategy = yield* call(getCurrentMutexFetchingStrategy);

  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
    fetchingStrategy,
    runningContinuousMutexAcquiringSaga: null,
    runningAdHocMutexAcquiringSaga: null,
    subscribersToMutex: {},
  };
  return mutexLogicState;
}

// Should only be accessed via getMutexLogicState().
let mutexLogicState: MutexLogicState | null = null;

// Exported to be used in tests.
export function getMutexLogicState(): MutexLogicState {
  if (!mutexLogicState) {
    throw new Error("Mutex state not yet loaded!");
  }
  return mutexLogicState;
}

function setMutexLogicSate(state: MutexLogicState): void {
  mutexLogicState = state;
}

export function* annotationMutexSaga(): Saga<void> {
  /*
   * This saga is directly called by the root saga.
   *
   */
  yield* call(ensureWkInitialized);
  // If the user is potentially allowed to update the annotation, start mutex fetching procedure.
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) {
    // We are in an read-only annotation. There's no point in acquiring mutexes.
    return;
  }

  const mutexLogicState = yield* call(determineInitialMutexLogicState);
  setMutexLogicSate(mutexLogicState);

  yield* fork(watchMutexStateChangesForNotification, mutexLogicState);
  yield* fork(watchForCollaborationModeChange, mutexLogicState);
  yield* fork(watchForDisableSaving, mutexLogicState);
  yield* fork(watchForAnnotationExit);
  yield* takeEvery(["SUBSCRIBE_TO_ANNOTATION_MUTEX"], autoTimeoutSubscription);

  yield* call(ensureCorrectMutexAcquiringSagaIsRunning, mutexLogicState);
}

function getUnsubscribeFromAnnotationMutexSaga(
  id: number,
  warnIfAlreadyUnsubscribed: boolean = true,
): () => Saga<void> {
  function* unsubscribe(): Saga<void> {
    const state = getMutexLogicState();
    const callerId = state.subscribersToMutex[id];
    console.log("unsubscribing to mutex as", callerId);
    if (!callerId) {
      if (warnIfAlreadyUnsubscribed) {
        console.warn(
          `Tried to unsubscribe from annotation mutex with id ${id} but it was not found. Maybe the unsubscribe was called multiple times.`,
        );
      }
      return;
    }
    delete state.subscribersToMutex[id];
    yield* put(unsubscribeFromAnnotationMutexAction(id));
    if (!state.runningAdHocMutexAcquiringSaga) {
      console.warn(
        "Unsubscribing from annotation mutex, while no saga is running that takes care of acquiring the annotation mutex. Unsubscriber id:",
        callerId,
      );
    }
    const hasNoSubscribersLeft = Object.keys(state.subscribersToMutex).length === 0;
    if (hasNoSubscribersLeft && state.runningAdHocMutexAcquiringSaga) {
      yield* call(cancelMutexSagaIfRunning, state, MutexFetchingStrategy.AdHoc);
      yield* call(releaseMutexIfAcquired);
    }
  }
  return unsubscribe;
}

const MUTEX_SUBSCRIPTION_TIMEOUT = 5 * 60 * 1000;
function* autoTimeoutSubscription(action: SubscribeToAnnotationMutexAction): Saga<void> {
  yield* call(waitUntilMutexIsAcquiredOrUnneeded);
  yield delay(MUTEX_SUBSCRIPTION_TIMEOUT);
  const warnIfAlreadyUnsubscribed = false;
  yield call(
    getUnsubscribeFromAnnotationMutexSaga(action.subscriptionId, warnIfAlreadyUnsubscribed),
  );
}

function* waitUntilMutexIsAcquiredOrUnneeded(): Saga<void> {
  while (true) {
    const doesHaveMutex = yield* call(getDoesHaveMutex);
    const othersMayEdit = yield* select((state) =>
      isAnnotationEditableByNonOwners(state.annotation),
    );
    if (doesHaveMutex || !othersMayEdit) {
      return;
    }
    yield* take("SET_IS_MUTEX_ACQUIRED");
  }
}

export function* subscribeToAnnotationMutex(callerId: string): Saga<() => Saga<void>> {
  /*
   * Blocks until the mutex annotation has been acquired and returns a function
   * which should be used to release the annotation mutex (note, that the mutex
   * will only be released when no other "subscription" is pending).
   * Note: There is default timeout on a subscription after which it will be invalid.
   * The idea is in case an operation is stuck to not block other users infinitely.
   */
  console.log("subscribing to mutex as", callerId);
  const state = getMutexLogicState();
  let newId = Math.round(Math.random() * 10000);
  while (newId in state.subscribersToMutex) {
    newId = Math.round(Math.random() * 10000);
  }
  state.subscribersToMutex[newId] = callerId;
  yield* put(subscribeToAnnotationMutexAction(newId, callerId));

  yield* call(ensureCorrectMutexAcquiringSagaIsRunning, state);

  yield* call(waitUntilMutexIsAcquiredOrUnneeded);
  return getUnsubscribeFromAnnotationMutexSaga(newId);
}

// Needed for tests
export function* clearAllSubscriptions() {
  const state = getMutexLogicState();
  for (const numId of Object.keys(state.subscribersToMutex)) {
    const unsubscribe = getUnsubscribeFromAnnotationMutexSaga(Number(numId));
    yield* call(unsubscribe);
  }
}

function* cancelMutexSagaIfRunning(
  mutexLogicState: MutexLogicState,
  strategy: MutexFetchingStrategy,
): Saga<void> {
  if (strategy === MutexFetchingStrategy.Continuously) {
    if (mutexLogicState.runningContinuousMutexAcquiringSaga != null) {
      yield* cancel(mutexLogicState.runningContinuousMutexAcquiringSaga);
      mutexLogicState.runningContinuousMutexAcquiringSaga = null;
    }
  } else {
    if (mutexLogicState.runningAdHocMutexAcquiringSaga != null) {
      yield* cancel(mutexLogicState.runningAdHocMutexAcquiringSaga);
      mutexLogicState.runningAdHocMutexAcquiringSaga = null;
    }
  }
}

function* ensureCorrectMutexAcquiringSagaIsRunning(mutexLogicState: MutexLogicState): Saga<void> {
  // Restarts the correct mutex saga (non-blocking)
  yield spawnUntilCanceled(function* () {
    const isSavingDisabled = yield* select((state) => state.save.isSavingDisabled);
    if (isSavingDisabled) {
      // Cancellation of running mutex sagas when saving is disabled is handled
      // by watchForDisableSaving.
      return;
    }
    const newFetchingStrategy = yield* call(getCurrentMutexFetchingStrategy);
    const oldFetchingStrategy = mutexLogicState.fetchingStrategy;
    const didStrategyChange = newFetchingStrategy !== oldFetchingStrategy;
    if (didStrategyChange) {
      yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.Continuously);
      yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.AdHoc);
    }
    const othersMayEdit = yield* select((state) =>
      isAnnotationEditableByNonOwners(state.annotation),
    );
    if (!othersMayEdit) {
      return;
    }
    const hasNoRunningMutexAcquiringSaga =
      mutexLogicState.runningContinuousMutexAcquiringSaga == null &&
      mutexLogicState.runningAdHocMutexAcquiringSaga == null;
    if (didStrategyChange || hasNoRunningMutexAcquiringSaga) {
      mutexLogicState.fetchingStrategy = newFetchingStrategy;
      yield* call(startSagaWithAppropriateMutexFetchingStrategy, mutexLogicState);
    }
  });
}

function* startSagaWithAppropriateMutexFetchingStrategy(
  mutexLogicState: MutexLogicState,
): Saga<void> {
  // Uses fork to start adhoc or continuous mutex sagas
  if (mutexLogicState.fetchingStrategy === MutexFetchingStrategy.AdHoc) {
    const hasActiveMutexSubscribers = Object.keys(mutexLogicState.subscribersToMutex).length > 0;
    // While the fetching strategy is ad hoc, updating should be allowed.
    yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(true));
    if (hasActiveMutexSubscribers) {
      const taskPermanentlyAcquiringMutex = yield* fork(tryAcquireMutexForSaving, mutexLogicState);
      mutexLogicState.runningAdHocMutexAcquiringSaga = taskPermanentlyAcquiringMutex;
    } else {
      // If we still have the mutex, release it first as strategy is now ad-hoc.
      yield* call(releaseMutexIfAcquired);
    }
  } else {
    const continuousSaga = yield* fork(tryAcquireMutexContinuously, mutexLogicState);
    mutexLogicState.runningContinuousMutexAcquiringSaga = continuousSaga;
  }
}

function* tryAcquireMutexContinuously(mutexLogicState: MutexLogicState): Saga<never> {
  /*
   * Try to acquire mutex indefinitely (saga can be cancelled from the outside with cancel or
   * race).
   */
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  mutexLogicState.isInitialRequest = true;

  // We can simply use an infinite loop here, because the saga will be cancelled by
  // reactToOthersMayEditChanges when collaborationMode changes.
  while (true) {
    if (mutexLogicState.isInitialRequest) {
      // If the annotation was just opened, we immediately disallow updating the
      // annotation to prevent the user from editing before having the mutex.
      // After the initial request, we always refresh the existing mutex
      // which is why editing should be allowed (at least, until the mutex is lost).
      yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
    }
    try {
      const {
        canEdit,
        blockedByUser: blockedByUser,
        blockedBySessionId,
      } = yield* retry(
        RETRY_COUNT,
        ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
        acquireAnnotationMutex,
        annotationId,
        TAB_SESSION_ID,
      );
      if (mutexLogicState.isInitialRequest || !canEdit) {
        // Only change isUpdatingAnnotationCurrentlyAllowed directly after
        // the initial request OR when we disable editing.
        // This forces users to refresh the page once the waiting for the mutex
        // has succeeded. We do this to be extra safe for now. Will be removed
        // with further advancements of the live collab feature.
        yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(canEdit));
      }
      yield* put(setUserHoldingMutexAction(blockedByUser, blockedBySessionId));

      if (canEdit !== (yield* call(getDoesHaveMutex))) {
        // Only dispatch the action if it changes the store to avoid
        // unnecessary notifications.
        yield* put(setIsMutexAcquiredAction(canEdit));
      }
    } catch (error) {
      // No need to check whether the saga was cancelled.
      // A cancelled saga does not reach the catch block but the finally block.
      // The error is printed before the first yield here, since it would be
      // swallowed in the test contexts otherwise (making debugging harder).
      console.error("Error while trying to acquire mutex.", error);
      yield* put(setUserHoldingMutexAction(undefined));
      yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
      if (yield* call(getDoesHaveMutex)) {
        yield* put(setIsMutexAcquiredAction(false));
      }
    }
    mutexLogicState.isInitialRequest = false;
    yield* race({
      timeout: call(delay, ACQUIRE_MUTEX_INTERVAL),
      retry: take("RETRY_MUTEX_ACQUISITION_NOW"),
    });
  }
}

function* acquireMutexInitiallyForAdHocStrategy(annotationId: string): Saga<void> {
  let backoffTime = INITIAL_BACKOFF_TIME;
  const startingTime = Date.now();
  let canEdit = false;
  let blockedByUser = null;
  let showingToast = false;

  // We can simply use an infinite loop here, because the saga will be cancelled by
  // reactToOthersMayEditChanges when collaborationMode changes.
  while (true) {
    try {
      const mutexResult = yield* call(acquireAnnotationMutex, annotationId, TAB_SESSION_ID);
      canEdit = mutexResult.canEdit;
      blockedByUser = mutexResult.blockedByUser;

      yield* put(setUserHoldingMutexAction(blockedByUser, mutexResult.blockedBySessionId));
      yield* put(setIsMutexAcquiredAction(canEdit));
      if (canEdit) {
        Toast.close(MUTEX_BLOCKED_FOR_TOO_LONG_KEY);
        return;
      }
    } catch (error) {
      if (import.meta.env.MODE === "test") {
        // In unit tests, that explicitly control this generator function,
        // the console.error after the next yield won't be printed, because
        // test assertions on the yield will already throw.
        // Therefore, we also print the error in the test context.
        console.error("Error while trying to acquire mutex:", error);
      }
      console.error("Error while trying to acquire mutex.", error);
    }
    if (!showingToast && Date.now() - startingTime > MAX_AD_HOC_RETRY_TIME) {
      const blockingUserName = blockedByUser
        ? `${blockedByUser.firstName} ${blockedByUser.lastName}`
        : "unknown";
      Toast.warning(
        `Could not get the annotations write-lock for more than ${MAX_AD_HOC_RETRY_TIME / 1000} seconds.
        User ${blockingUserName} is currently blocking the annotation.
        Retrying...`,
        { sticky: true, key: MUTEX_BLOCKED_FOR_TOO_LONG_KEY },
      );
      showingToast = true;
    }

    const backOffJitter =
      Math.random() * (BACKOFF_JITTER_UPPER_PERCENT - BACKOFF_JITTER_LOWER_PERCENT) +
      BACKOFF_JITTER_LOWER_PERCENT;
    backoffTime = Math.min(
      backoffTime * BACKOFF_TIME_MULTIPLIER + backoffTime * backOffJitter,
      MAX_AD_HOC_RETRY_TIME,
    );
    yield* call(delay, backoffTime);
  }
}

function* keepAnnotationMutexForAdHocStrategy(annotationId: string): Saga<void> {
  // We got the mutex once, now keep it until this saga is cancelled due to saving finished.
  let canEdit = true;
  let blockedByUser = null;
  let blockedBySessionId = null;
  // Wait a little since we already just acquired the mutex in acquireMutexInitiallyForAdHocStrategy.
  yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
  while (true) {
    try {
      const mutexInfo = yield* call(acquireAnnotationMutex, annotationId, TAB_SESSION_ID);
      canEdit = mutexInfo.canEdit;
      blockedByUser = mutexInfo.blockedByUser;
      blockedBySessionId = mutexInfo.blockedBySessionId;
      yield* put(setUserHoldingMutexAction(blockedByUser, mutexInfo.blockedBySessionId));
      yield* put(setIsMutexAcquiredAction(canEdit));
      if (canEdit) {
        // Only wait for next refetching of the mutex in case the user can edit.
        // Else directly go to the error case outside the try-catch block below.
        yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
      }
    } catch (error) {
      console.error("Failed to continuously acquire mutex.", error);
      yield* put(setUserHoldingMutexAction(undefined));
      yield* put(setIsMutexAcquiredAction(false));
      Toast.warning(
        "Unable to get write-lock needed to update the annotation. Please check your connection to WEBKNOSSOS. See the console for more information. Retrying soon.",
      );
      yield* call(delay, DELAY_AFTER_FAILED_MUTEX_FETCH);
    }
    // This needs to be outside of the try block to make sure this saga crashes as intended.
    if (!canEdit) {
      // If this code is reached, the user once already had the mutex, but re-acquiring was needed as saving took quite long.
      // In case of a network error, the catch block should take care of re-trying to acquire the mutex.
      // But if the server replies that the current user cannot edit at the moment, the previously acquired mutex must have
      // expired and another user must have it at the moment. This means that there a likely saving and version conflicts now as
      // this user lost the mutex while still in the process of syncing with the backend. Thus, throwing an error to show a toast and crashing the saga
      // leads the user to having to reload wk to minimize lost work, instead of allowing to continue to edit data.
      throw new Error(
        `No longer owner of the annotation mutex. Instead user ${
          blockedByUser || blockedBySessionId
            ? `${blockedByUser?.firstName} ${blockedByUser?.lastName} (${blockedByUser?.id}, sessionId=${blockedBySessionId})`
            : "unknown user"
        } has the mutex.`,
      );
    }
  }
}

function* tryAcquireMutexForSaving(mutexLogicState: MutexLogicState): Saga<void> {
  /*
   * Try to acquire mutex indefinitely (saga can be cancelled from the outside with cancel or
   * race).
   */
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  mutexLogicState.isInitialRequest = true; // Never show popup about the mutex now being acquired.

  yield* call(acquireMutexInitiallyForAdHocStrategy, annotationId);
  yield* call(keepAnnotationMutexForAdHocStrategy, annotationId);
}

function* watchForCollaborationModeChange(mutexLogicState: MutexLogicState): Saga<void> {
  function* onChange({ collaborationMode }: SetCollaborationModeAction): Saga<void> {
    if (collaborationMode !== "OwnerOnly") {
      yield* call(ensureCorrectMutexAcquiringSagaIsRunning, mutexLogicState);
    } else {
      // Collaboration was turned off by the activeUser. Cancel any running mutex
      // acquisition saga and release the mutex if currently held.
      yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.Continuously);
      yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.AdHoc);
      yield* call(releaseMutexIfAcquired);
      // Since only the owner can turn off collaboration, they should be able to edit, too.
      // Still, let's check that owner === activeUser to be extra safe.
      const owner = yield* select((storeState) => storeState.annotation.owner);
      const activeUser = yield* select((state) => state.activeUser);
      const isAnnotationOwner = (activeUser && owner?.id === activeUser?.id) || false;
      yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(isAnnotationOwner));
    }
  }
  yield* takeEvery("SET_COLLABORATION_MODE", onChange);
}

function* watchForDisableSaving(mutexLogicState: MutexLogicState): Saga<void> {
  yield* take("DISABLE_SAVING");
  yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.Continuously);
  yield* call(cancelMutexSagaIfRunning, mutexLogicState, MutexFetchingStrategy.AdHoc);
  yield* call(releaseMutexIfAcquired);
}

function* watchMutexStateChangesForNotification(mutexLogicState: MutexLogicState): Saga<void> {
  let wasMutexAlreadyAcquiredBefore = yield* select(
    (state) => state.save.mutexState.hasAnnotationMutex,
  );

  yield* takeEvery(
    "SET_IS_MUTEX_ACQUIRED",
    function* ({ isMutexAcquired }: SetIsMutexAcquiredAction) {
      try {
        const othersMayEdit = yield* select((state) =>
          isAnnotationEditableByNonOwners(state.annotation),
        );
        const isSavingDisabled = yield* select((state) => state.save.isSavingDisabled);
        if (
          !othersMayEdit ||
          isSavingDisabled ||
          mutexLogicState.fetchingStrategy === MutexFetchingStrategy.AdHoc
        ) {
          Toast.close(MUTEX_NOT_ACQUIRED_KEY);
          Toast.close(MUTEX_ACQUIRED_KEY);
          return;
        }
        if (isMutexAcquired) {
          Toast.close(MUTEX_NOT_ACQUIRED_KEY);
          if (!mutexLogicState.isInitialRequest && !wasMutexAlreadyAcquiredBefore) {
            const message = (
              <>
                {messages["annotation.acquiringMutexSucceeded"]}
                <Button onClick={() => location.reload()}>Reload the annotation</Button>
              </>
            );
            Toast.success(message, { sticky: true, key: MUTEX_ACQUIRED_KEY });
          }
        } else {
          Toast.close(MUTEX_ACQUIRED_KEY);
          const activeUser = yield* select((state) => state.activeUser);
          const blockedByUser = yield* select((state) => state.save.mutexState.blockedByUser);
          const blockedBySessionId = yield* select(
            (state) => state.save.mutexState.blockedBySessionId,
          );
          let message: string;
          if (
            blockedByUser != null &&
            blockedByUser.id === activeUser?.id &&
            blockedBySessionId !== TAB_SESSION_ID
          ) {
            message = messages["annotation.acquiringMutexFailed.sameUserDifferentSession"];
          } else if (blockedByUser != null) {
            message = messages["annotation.acquiringMutexFailed"]({
              userName: `${blockedByUser.firstName} ${blockedByUser.lastName}`,
            });
          } else {
            message = messages["annotation.acquiringMutexFailed.noUser"];
          }
          // Wait a bit before showing the toast to the user. Otherwise,
          // a toast can flash briefly while the user is navigating away (because
          // the mutex is released when navigating away) which is rather confusing.
          // Also, we need to delegate back to the saga middleware so that
          // this saga can be properly cancelled.
          yield* delay(500);
          const stillHasNoMutex = !(yield* select(
            (state) => state.save.mutexState.hasAnnotationMutex,
          ));
          if (stillHasNoMutex) {
            // Only show the warning if there is still no toast. Due to the 500ms delay,
            // a new mutex acuiqre could have happened theoretically.
            Toast.warning(message, { key: MUTEX_NOT_ACQUIRED_KEY });
          }
        }
        wasMutexAlreadyAcquiredBefore = yield* select(
          (state) => state.save.mutexState.hasAnnotationMutex,
        );
        mutexLogicState.isInitialRequest = false;
      } finally {
        if (yield* cancelled()) {
          Toast.close(MUTEX_NOT_ACQUIRED_KEY);
          Toast.close(MUTEX_ACQUIRED_KEY);
        }
      }
    },
  );
}

function* watchForAnnotationExit(): Saga<void> {
  yield* takeEvery("EXITING_ANNOTATION", function* () {
    const hasMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
    if (!hasMutex) return;

    const annotationId = yield* select((state) => state.annotation.annotationId);
    const sent = releaseAnnotationMutexWithBeacon(annotationId, TAB_SESSION_ID);
    console.log(
      `[Mutex] Releasing mutex for annotation ${annotationId} on exit via sendBeacon (queued: ${sent}).`,
    );

    if (sent) {
      yield* put(setIsMutexAcquiredAction(false));
      yield* put(setUserHoldingMutexAction(null));
    }
  });
}

function* releaseMutexIfAcquired() {
  const currentlyHavingMutex = yield* select((state) => state.save.mutexState.hasAnnotationMutex);
  if (!currentlyHavingMutex) {
    // Nothing to do.
    return;
  }
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  let successfullyReleaseMutex = false;
  let backoffTime = 1000;
  // Enforce released mutex even when initial request failed due to e.g. network error.
  // In case another user got the mutex in meantime, releasing this users mutex still yield a successful request.
  while (!successfullyReleaseMutex) {
    try {
      yield call(releaseAnnotationMutex, annotationId, TAB_SESSION_ID);
      successfullyReleaseMutex = true;
    } catch (error) {
      console.error("Could not release mutex", error);
      yield delay(backoffTime);
      backoffTime = Math.min(backoffTime ** 2, MAX_RELEASE_RETRY_INTERVAL);
    }
  }
  yield* put(setUserHoldingMutexAction(null));
  yield* put(setIsMutexAcquiredAction(false));
}
