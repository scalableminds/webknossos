import { acquireAnnotationMutex } from "admin/rest_api";
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
  type EnsureMaySaveNowAction,
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
const RETRY_COUNT = 20; // 12 retries with 60/12=5 seconds backup delay
const INITIAL_BACKOFF_TIME = 1000;
const BACKOFF_TIME_MULTIPLIER = 1.5;
const BACKOFF_JITTER_LOWER_PERCENT = 0.0;
const BACKOFF_JITTER_UPPER_PERCENT = 0.15;

// TODOM
const DISABLE_EAGER_MUTEX_ACQUISITION = true;

type MutexLogicState = {
  isInitialRequest: boolean;
  onlyRequiredOnSave: boolean;
  runningMutexAcquiringSaga: FixedTask<void> | null;
};

function* getDoesHaveMutex(): Saga<boolean> {
  return yield* select((state) => state.save.mutexState.hasAnnotationMutex);
}

function* resolveEnsureMaySaveNowActions(action: EnsureMaySaveNowAction) {
  /*
   * For each EnsureMaySaveNowAction wait until we have the mutex. Then call
   * the callback.
   */
  while (true) {
    const doesHaveMutex = yield* call(getDoesHaveMutex);
    const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
    if (doesHaveMutex || !othersMayEdit) {
      action.callback();
      return;
    }
    yield* take(["SET_USER_HOLDING_MUTEX", "SET_IS_MUTEX_ACQUIRED"]);
  }
}

const TOOLS_WITH_ON_DEMAND_MUTEX_SUPPORT = [
  AnnotationTool.MOVE.id,
  AnnotationTool.PROOFREAD.id,
  AnnotationTool.LINE_MEASUREMENT.id,
  AnnotationTool.AREA_MEASUREMENT.id,
] as AnnotationToolId[];

function* determineInitialMutexLogicState(): Saga<MutexLogicState> {
  let onlyRequiredOnSave = false;
  const activeVolumeTracing = yield* select(getActiveSegmentationTracing);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (
    DISABLE_EAGER_MUTEX_ACQUISITION &&
    activeVolumeTracing?.hasEditableMapping &&
    activeVolumeTracing?.mappingIsLocked &&
    TOOLS_WITH_ON_DEMAND_MUTEX_SUPPORT.includes(activeTool.id)
  ) {
    // The active annotation is currently in proofreading state. Thus, having the mutex only on save demand works in regards to the current milestone.
    onlyRequiredOnSave = true;
  }

  const mutexLogicState: MutexLogicState = {
    isInitialRequest: true,
    onlyRequiredOnSave,
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
  yield* takeEvery("ENSURE_MAY_SAVE_NOW", resolveEnsureMaySaveNowActions);

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
    tryAcquireMutexOnceNeeded,
    mutexLogicState,
  );
}

function* tryAcquireMutexOnceNeeded(mutexLogicState: MutexLogicState): Saga<void> {
  console.log(
    "Acquiring mutex mutexLogicState.onlyRequiredOnSave",
    mutexLogicState.onlyRequiredOnSave,
  );
  if (mutexLogicState.onlyRequiredOnSave) {
    yield* call(tryAcquireMutexOnSaveNeeded, mutexLogicState);
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

// TODO:
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
  while (hasMutex) {
    console.log("tryAcquireMutexForSaving loop");
    try {
      const { canEdit } = yield* call(acquireAnnotationMutex, annotationId);
      if (canEdit) {
        yield* put(setIsMutexAcquiredAction(canEdit));
        hasMutex = true;
      }
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
    const { canEdit } = yield* call(acquireAnnotationMutex, annotationId);
    if (!canEdit) {
      // TODOM: Thnk of a better way to handle this.
      console.error("Failed to continuously acquire mutex.");
    }
    yield* call(delay, ACQUIRE_MUTEX_INTERVAL);
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
    const previousOnlyRequiredOnSaveState = mutexLogicState.onlyRequiredOnSave;
    if (value === false) {
      // New volume annotation layer was activated. Check if this is a proofreading only annotation to determine whether the mutex should be fetched only on save.
      const isMappingEditable = yield* select((state) => hasEditableMapping(state, layerName));
      const isLockedMapping = yield* select((state) => isMappingLocked(state, layerName));
      if (DISABLE_EAGER_MUTEX_ACQUISITION && isMappingEditable && isLockedMapping) {
        // We are in a proofreading annotation -> Turn on on save mutex acquiring.
        mutexLogicState.onlyRequiredOnSave = true;
      } else {
        mutexLogicState.onlyRequiredOnSave = false;
      }
    } else {
      mutexLogicState.onlyRequiredOnSave = false;
    }
    if (previousOnlyRequiredOnSaveState !== mutexLogicState.onlyRequiredOnSave) {
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
    const newOnlyRequiredOnSave = TOOLS_WITH_ON_DEMAND_MUTEX_SUPPORT.includes(newToolId);
    if (newOnlyRequiredOnSave !== mutexLogicState.onlyRequiredOnSave) {
      mutexLogicState.onlyRequiredOnSave = newOnlyRequiredOnSave;
      yield* call(restartMutexAcquiringSaga, mutexLogicState);
    }
  }
  yield* takeEvery(["SET_TOOL", "CYCLE_TOOL"], reactToActiveToolChange);
}

function* tryAcquireMutexOnSaveNeeded(mutexLogicState: MutexLogicState): Saga<never> {
  while (true) {
    // console.log("taking ENSURE_MAY_SAVE_NOW");
    yield* take("ENSURE_MAY_SAVE_NOW");
    // console.log("took ENSURE_MAY_SAVE_NOW");
    // TODOM: ensure tryAcquireMutexForSaving works correctly even when mutex not received initially.
    // Write tests for this!
    const { doneSaving } = yield* race({
      tryAcquireMutexForSaving: fork(tryAcquireMutexForSaving, mutexLogicState),
      doneSaving: take("DONE_SAVING"),
    });
    if (doneSaving) {
      yield* cancel(mutexLogicState.runningMutexAcquiringSaga);
      // No need to keep continuously fetching the mutex as saving was successful.
      yield* call(restartMutexAcquiringSaga, mutexLogicState);
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
  yield* retry(
    RETRY_COUNT,
    ACQUIRE_MUTEX_INTERVAL / RETRY_COUNT,
    acquireAnnotationMutex,
    annotationId,
  );
  yield* put(setIsUpdatingAnnotationCurrentlyAllowedAction(true));
  yield* put(setUserHoldingMutexAction(null));
}
