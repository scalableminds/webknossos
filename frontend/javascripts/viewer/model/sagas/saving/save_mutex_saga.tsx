import { acquireAnnotationMutex, releaseAnnotationMutex } from "admin/rest_api";
import { Button } from "antd";
import Toast from "libs/toast";
import messages from "messages";
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
import { WkDevFlags } from "viewer/api/wk_dev";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  hasEditableMapping,
  isMappingLocked,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  type SetOthersMayEditForAnnotationAction,
  setIsUpdatingAnnotationCurrentlyAllowedAction,
} from "viewer/model/actions/annotation_actions";
import {
  type EnsureHasAnnotationMutexAction,
  type SetIsMutexAcquiredAction,
  setIsMutexAcquiredAction,
  setUserHoldingMutexAction,
} from "viewer/model/actions/save_actions";
import type { UpdateLayerSettingAction } from "viewer/model/actions/settings_actions";
import type { CycleToolAction, SetToolAction } from "viewer/model/actions/ui_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "../ready_sagas";

// Also refer to application.conf where annotation.mutex.expiryTime is defined
// (typically, 2 minutes).

const MUTEX_NOT_ACQUIRED_KEY = "MutexCouldNotBeAcquired";
const MUTEX_ACQUIRED_KEY = "AnnotationMutexAcquired";
const ACQUIRE_MUTEX_INTERVAL = 1000 * 60;
const DELAY_AFTER_FAILED_MUTEX_FETCH = 1000 * 10;
const RETRY_COUNT = 20; // 12 retries with 60/12=5 seconds backup delay
const INITIAL_BACKOFF_TIME = 1000;
const BACKOFF_TIME_MULTIPLIER = 1.5;
const BACKOFF_JITTER_LOWER_PERCENT = 0.0;
const BACKOFF_JITTER_UPPER_PERCENT = 0.15;

enum MutexFetchingStrategy {
  AdHoc = "AdHoc",
  Continuously = "Continuously",
}

type MutexLogicState = {
  isInitialRequest: boolean;
  fetchingStrategy: MutexFetchingStrategy;
  runningMutexAcquiringSaga: FixedTask<void> | null;
};

function* getDoesHaveMutex(): Saga<boolean> {
  return yield* select((state) => state.save.mutexState.hasAnnotationMutex);
}

function* resolveEnsureHasAnnotationMutexActions(action: EnsureHasAnnotationMutexAction) {
  /*
   * For each EnsureHasAnnotationMutexAction wait until we have the mutex. Then call
   * the callback.
   */
  while (true) {
    const doesHaveMutex = yield* call(getDoesHaveMutex);
    const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
    if (doesHaveMutex || !othersMayEdit) {
      action.callback();
      return;
    }
    yield* take("SET_IS_MUTEX_ACQUIRED");
  }
}

const TOOLS_WITH_AD_HOC_MUTEX_SUPPORT = [
  AnnotationTool.MOVE.id,
  AnnotationTool.PROOFREAD.id,
  AnnotationTool.LINE_MEASUREMENT.id,
  AnnotationTool.AREA_MEASUREMENT.id,
] as AnnotationToolId[];

function* determineInitialMutexLogicState(): Saga<MutexLogicState> {
  let fetchingStrategy = MutexFetchingStrategy.Continuously;
  const activeVolumeTracing = yield* select(getActiveSegmentationTracing);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (
    WkDevFlags.liveCollab &&
    activeVolumeTracing?.hasEditableMapping &&
    activeVolumeTracing?.mappingIsLocked &&
    TOOLS_WITH_AD_HOC_MUTEX_SUPPORT.includes(activeTool.id)
  ) {
    // The active annotation is currently in proofreading state. Thus, having the mutex only on save demand works in regards to the current milestone.
    fetchingStrategy = MutexFetchingStrategy.AdHoc;
  }

  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
    fetchingStrategy,
    runningMutexAcquiringSaga: null,
  };
  return mutexLogicState;
}

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  /*
   * This saga is directly called by the root saga.
   *
   */
  yield* call(ensureWkReady);
  // If the user is potentially allowed to update the annotation, start mutex fetching procedure.
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) {
    // We are in an read-only annotation. There's no point in acquiring mutexes.
    console.log("exit mutex saga");
    return;
  }

  const mutexLogicState = yield* call(determineInitialMutexLogicState);

  console.log("initial mutexLogicState", mutexLogicState);

  yield* fork(watchMutexStateChangesForNotification, mutexLogicState);
  yield* fork(watchForOthersMayEditChange, mutexLogicState);
  yield* fork(watchForActiveVolumeTracingChange, mutexLogicState);
  yield* fork(watchForActiveToolChange, mutexLogicState);
  yield* takeEvery("ENSURE_HAS_ANNOTATION_MUTEX", resolveEnsureHasAnnotationMutexActions);

  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
  if (othersMayEdit) {
    // Only start initial acquiring of mutex if othersMayEdit is already turned on.
    yield* call(restartMutexAcquiringSaga, mutexLogicState);
  }
}

function* restartMutexAcquiringSaga(mutexLogicState: MutexLogicState): Saga<void> {
  console.log("restartMutexAcquiringSaga called");
  if (mutexLogicState.runningMutexAcquiringSaga != null) {
    yield* cancel(mutexLogicState.runningMutexAcquiringSaga);
  }
  mutexLogicState.runningMutexAcquiringSaga = yield* fork(
    startSagaWithAppropriateMutexFetchingStrategy,
    mutexLogicState,
  );
}

function* startSagaWithAppropriateMutexFetchingStrategy(
  mutexLogicState: MutexLogicState,
): Saga<void> {
  console.log(
    "Acquiring mutex mutexLogicState.onlyRequiredOnSave",
    mutexLogicState.fetchingStrategy,
  );
  if (mutexLogicState.fetchingStrategy) {
    yield* call(acquireMutexUponEnsureHasAnnotationMutexAction, mutexLogicState);
  } else {
    yield* call(tryAcquireMutexContinuously, mutexLogicState);
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
    const blockedByUser = yield* select((state) => state.save.mutexState.blockedByUser);
    if (blockedByUser == null || blockedByUser.id !== activeUser?.id) {
      // If the annotation is currently not blocked by the active user,
      // we immediately disallow updating the annotation.
      yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
    }
    try {
      const { canEdit, blockedByUser: blockedByUser } = yield* retry(
        RETRY_COUNT,
        ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
        acquireAnnotationMutex,
        annotationId,
      );
      yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(canEdit));
      yield* put(setUserHoldingMutexAction(blockedByUser));
      yield* put(setIsMutexAcquiredAction(canEdit));

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
        yield* put(setUserHoldingMutexAction(undefined));
        yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(false));
        if (yield* call(getDoesHaveMutex)) {
          yield* put(setIsMutexAcquiredAction(false));
        }
      }
    }
    mutexLogicState.isInitialRequest = false;
    yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
  }
}

function* tryAcquireMutexForSaving(mutexLogicState: MutexLogicState): Saga<void> {
  /*
   * Try to acquire mutex indefinitely (saga can be cancelled from the outside with cancel or
   * race).
   */
  console.log("started tryAcquireMutexForSaving");
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  mutexLogicState.isInitialRequest = true; // Never show popup about the mutex now being acquired.
  let hasMutex = false;
  let backoffTime = INITIAL_BACKOFF_TIME;

  // We can simply use an infinite loop here, because the saga will be cancelled by
  // reactToOthersMayEditChanges when othersMayEdit is set to false.
  while (!hasMutex) {
    console.log("tryAcquireMutexForSaving loop");
    try {
      const { canEdit, blockedByUser } = yield* call(acquireAnnotationMutex, annotationId);
      if (canEdit) {
        hasMutex = true;
      }
      yield* put(setUserHoldingMutexAction(blockedByUser));
      yield* put(setIsMutexAcquiredAction(canEdit));
    } catch (error) {
      if (process.env.IS_TESTING) {
        // In unit tests, that explicitly control this generator function,
        // the console.error after the next yield won't be printed, because
        // test assertions on the yield will already throw.
        // Therefore, we also print the error in the test context.
        console.error("Error while trying to acquire mutex:", error);
      }
      console.error("Error while trying to acquire mutex.", error);
    }
    const wasCanceled = yield* cancelled();
    console.log("wasCanceled", wasCanceled);
    if (wasCanceled) {
      return;
    }
    const backOffJitter =
      Math.random() * (BACKOFF_JITTER_UPPER_PERCENT - BACKOFF_JITTER_LOWER_PERCENT) +
      BACKOFF_JITTER_LOWER_PERCENT;
    backoffTime = Math.min(
      backoffTime * BACKOFF_TIME_MULTIPLIER + backoffTime * backOffJitter,
      ACQUIRE_MUTEX_INTERVAL,
    );
    yield* call(delay, backoffTime);
  }
  // We got the mutex once, now keep it until this saga is cancelled due to saving finished.
  while (hasMutex) {
    try {
      const { canEdit, blockedByUser } = yield* call(acquireAnnotationMutex, annotationId);
      if (!canEdit) {
        // TODOM: Think of a better way to handle this. This should usually never happen only if a client disconnects for a longer time while saving.
        // Maybe its ok to crash / enforce a reload in that case.
        // One scenario in which this might happen is when the user disconnects from the internet while having the mutex and later reconnects.
        throw new Error(
          `No longer owner of the annotation mutex. Instead user ${blockedByUser ? `${blockedByUser.firstName} ${blockedByUser?.lastName} (${blockedByUser?.id})` : "unknown user"} has the mutex.`,
        );
      }
      yield* put(setUserHoldingMutexAction(blockedByUser));
      yield* put(setIsMutexAcquiredAction(canEdit));
      yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
    } catch (error) {
      console.error("Failed to continuously acquire mutex.", error);
      yield* put(setUserHoldingMutexAction(undefined));
      yield* put(setIsMutexAcquiredAction(false));
      Toast.error(
        "Unable to get write-lock needed to update the annotation. Please check your connection to WEBKNOSSOS. See the console for more information. Retrying soon.",
      );
      yield* call(delay, DELAY_AFTER_FAILED_MUTEX_FETCH);
    }
  }
}

function* watchForOthersMayEditChange(mutexLogicState: MutexLogicState): Saga<void> {
  function* reactToOthersMayEditChanges({
    othersMayEdit,
  }: SetOthersMayEditForAnnotationAction): Saga<void> {
    if (othersMayEdit) {
      yield* call(restartMutexAcquiringSaga, mutexLogicState);
    } else {
      // othersMayEdit was turned off by the activeUser. Since this is only
      // allowed by the owner, they should be able to edit the annotation, too.
      // Still, let's check that owner === activeUser to be extra safe.
      const owner = yield* select((storeState) => storeState.annotation.owner);
      const activeUser = yield* select((state) => state.activeUser);
      if (activeUser && owner?.id === activeUser?.id) {
        yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(true));
      }
    }
  }
  yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);
}

function* watchForActiveVolumeTracingChange(mutexLogicState: MutexLogicState): Saga<void> {
  function* reactToActiveVolumeAnnotationChange({
    layerName,
    propertyName,
    value,
  }: UpdateLayerSettingAction): Saga<void> {
    if (propertyName !== "isDisabled") {
      return;
    }
    const previousOnlyRequiredOnSaveState = mutexLogicState.fetchingStrategy;
    if (value === false) {
      // New volume annotation layer was activated. Check if this is a proofreading only annotation to determine whether the mutex should be fetched only on save.
      const isMappingEditable = yield* select((state) => hasEditableMapping(state, layerName));
      const isLockedMapping = yield* select((state) => isMappingLocked(state, layerName));
      if (WkDevFlags.liveCollab && isMappingEditable && isLockedMapping) {
        // We are in a proofreading annotation -> Turn on on save mutex acquiring.
        mutexLogicState.fetchingStrategy = MutexFetchingStrategy.AdHoc;
      } else {
        mutexLogicState.fetchingStrategy = MutexFetchingStrategy.Continuously;
      }
    } else {
      mutexLogicState.fetchingStrategy = MutexFetchingStrategy.Continuously;
    }
    if (previousOnlyRequiredOnSaveState !== mutexLogicState.fetchingStrategy) {
      yield* call(restartMutexAcquiringSaga, mutexLogicState);
    }
  }
  yield* takeEvery("UPDATE_LAYER_SETTING", reactToActiveVolumeAnnotationChange);
}

function* watchForActiveToolChange(mutexLogicState: MutexLogicState): Saga<void> {
  function* reactToActiveToolChange(action: SetToolAction | CycleToolAction): Saga<void> {
    let newToolId;
    if (action.type === "SET_TOOL") {
      newToolId = action.tool.id;
    } else {
      // Cycle Tool action
      const newActiveTool = yield* select((state) => state.uiInformation.activeTool);
      newToolId = newActiveTool.id;
    }

    // TODO: also check for livecollab flag and editable mapping locked and so on.
    const isToolWithAdHocSupportActive = TOOLS_WITH_AD_HOC_MUTEX_SUPPORT.includes(newToolId);
    const isCurrentlyAdHocFetching =
      mutexLogicState.fetchingStrategy === MutexFetchingStrategy.AdHoc;
    if (isToolWithAdHocSupportActive !== isCurrentlyAdHocFetching) {
      mutexLogicState.fetchingStrategy = isToolWithAdHocSupportActive
        ? MutexFetchingStrategy.AdHoc
        : MutexFetchingStrategy.Continuously;
      yield* call(restartMutexAcquiringSaga, mutexLogicState);
    }
  }
  yield* takeEvery(["SET_TOOL", "CYCLE_TOOL"], reactToActiveToolChange);
}

function* acquireMutexUponEnsureHasAnnotationMutexAction(
  mutexLogicState: MutexLogicState,
): Saga<never> {
  while (true) {
    yield* take("ENSURE_HAS_ANNOTATION_MUTEX");
    // TODOM: ensure tryAcquireMutexForSaving works correctly even when mutex not received initially.
    // Write tests for this!
    const { doneSaving } = yield* race({
      tryAcquireMutexForSaving: fork(tryAcquireMutexForSaving, mutexLogicState),
      doneSaving: take("DONE_SAVING"),
    });
    if (doneSaving) {
      console.log("releasing mutex");
      yield* call(releaseMutex);
    }
  }
}

function* watchMutexStateChangesForNotification(mutexLogicState: MutexLogicState): Saga<void> {
  let wasMutexAlreadyAcquiredBefore = yield* select(
    (state) => state.save.mutexState.hasAnnotationMutex,
  );
  yield* takeEvery(
    "SET_IS_MUTEX_ACQUIRED",
    function* ({ isMutexAcquired }: SetIsMutexAcquiredAction) {
      if (mutexLogicState.fetchingStrategy) {
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
        const blockedByUser = yield* select((state) => state.save.mutexState.blockedByUser);
        const message =
          blockedByUser != null
            ? messages["annotation.acquiringMutexFailed"]({
                userName: `${blockedByUser.firstName} ${blockedByUser.lastName}`,
              })
            : messages["annotation.acquiringMutexFailed.noUser"];
        Toast.warning(message, { sticky: true, key: MUTEX_NOT_ACQUIRED_KEY });
      }
      wasMutexAlreadyAcquiredBefore = yield* select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      mutexLogicState.isInitialRequest = false;
    },
  );
}

function* releaseMutex() {
  const annotationId = yield* select((storeState) => storeState.annotation.annotationId);
  // TODOM: Mutex is auto released after a Model.ensureSavedState or so, sometimes (e.g. a proofreading action),
  // directly triggers new updates afterwards. Currently, this needs to re-acquire the mutex, but that should be necessary IMO.
  yield* retry(
    RETRY_COUNT,
    ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
    releaseAnnotationMutex,
    annotationId,
  );
  yield* put(setUserHoldingMutexAction(null));
  yield* put(setIsMutexAcquiredAction(false));
}
