import type { ActionPattern } from "@redux-saga/types";
import { Modal } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import { call, delay, fork, put, race, spawn, take, takeEvery } from "typed-redux-saga";
import { MappingStatusEnum } from "viewer/constants";
import { type Action, escalateErrorAction } from "viewer/model/actions/actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { Store } from "viewer/singletons";
import type { ActiveMappingInfo, VolumeTracing, WebknossosState } from "viewer/store";
import {
  setMappingIsLockedAction,
  setVolumeBucketDataHasChangedAction,
} from "../actions/volumetracing_actions";
import {
  getOrCreateOperationContext,
  type OperationContext,
  type OperationOptions,
} from "./operation_context_saga";

export function* takeEveryInOperationContext<P extends ActionPattern>(
  actionDescriptor: P,
  saga: (action: Action, ctx: OperationContext) => Saga<void>,
  options: OperationOptions,
): Saga<void> {
  /* Listens for actions and runs the provided saga inside an operation context,
   * automatically acquiring and releasing the context. If an action carries an
   * operationContext field, that context is used as the parent (for nested operations);
   * otherwise creates a fresh context.
   * Ignores the action if the operation context cannot be acquired (i.e., another operation
   * is already ongoing which doesn't allow additional executions).
   */
  function* wrapper(action: Action) {
    const existingCtx = (action as any).operationContext ?? null;
    const ctx = yield* getOrCreateOperationContext(
      { ...options, behaviorWhenDisallowed: "ignore" },
      existingCtx,
    );
    if (ctx == null) {
      const operations = yield* select((state) => state.operationContext.activeOperations);
      console.warn(
        `Ignoring ${String((action as any).type)} operation, because another operation is already running (${operations.map((op) => op.id).join(", ")}).`,
      );
      return;
    }
    yield* ctx.execute(() => saga(action, ctx));
  }
  yield* takeEvery(actionDescriptor, wrapper);
}

type EnsureMappingIsLockedReturnType = {
  isMappingLockedIfNeeded: boolean;
  reason?: string;
};

export function askUserForLockingActiveMapping(
  volumeTracing: VolumeTracing,
  activeMappingByLayer: Record<string, ActiveMappingInfo>,
): Promise<EnsureMappingIsLockedReturnType> {
  return new Promise((resolve, reject) => {
    if (!volumeTracing.mappingIsLocked) {
      const lockMapping = async () => {
        // A mapping that is active and is being annotated needs to be locked to ensure a consistent state in the future.
        // See https://github.com/scalableminds/webknossos/issues/5431 for more information.
        const activeMapping = activeMappingByLayer[volumeTracing.tracingId];
        if (activeMapping.mappingName) {
          Store.dispatch(setMappingIsLockedAction(volumeTracing.tracingId));
          const message = messages["tracing.locked_mapping_confirmed"](activeMapping.mappingName);
          Toast.info(message, { timeout: 10000 });
          console.log(message);
          resolve({ isMappingLockedIfNeeded: true, reason: "User confirmed." });
        } else {
          // Having an active mapping without a name should be impossible. Therefore, no further error handling is done.
          reject({ isMappingLockedIfNeeded: false, reason: "No mapping name." });
        }
      };
      Modal.confirm({
        title: "Should the active Mapping be locked?",
        content: messages["tracing.locked_mapping_info"],
        okText: "Lock Mapping",
        cancelText: "Abort Annotation Action",
        width: 600,
        onOk: lockMapping,
        onCancel: () => {
          reject({ isMappingLockedIfNeeded: false, reason: "User aborted." });
        },
      });
    }
  });
}

export function* ensureMaybeActiveMappingIsLocked(
  volumeTracing: VolumeTracing,
): Saga<EnsureMappingIsLockedReturnType> {
  if (volumeTracing.mappingIsLocked) {
    return { isMappingLockedIfNeeded: true, reason: "Mapping is already locked." };
  }
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const isSomeMappingActive =
    volumeTracing.tracingId in activeMappingByLayer &&
    activeMappingByLayer[volumeTracing.tracingId].mappingStatus === MappingStatusEnum.ENABLED;
  const isHDF5Mapping =
    volumeTracing.tracingId in activeMappingByLayer &&
    activeMappingByLayer[volumeTracing.tracingId].mappingType !== "JSON";
  if (isSomeMappingActive && isHDF5Mapping) {
    try {
      return yield* call(askUserForLockingActiveMapping, volumeTracing, activeMappingByLayer);
    } catch (error: any) {
      return error as EnsureMappingIsLockedReturnType;
    }
  } else {
    yield* put(setMappingIsLockedAction(volumeTracing.tracingId));
    return { isMappingLockedIfNeeded: true, reason: "Locked that no mapping is active." };
  }
}

export function* requestBucketModificationInVolumeTracing(
  volumeTracing: VolumeTracing,
): Saga<boolean> {
  /*
   * Should be called when the modification of bucket data is about to happen. If
   * the saga returns false, the modification should be cancelled (this happens if
   * the user is not okay with locking the mapping).
   *
   * In detail: When the bucket data of a volume tracing is supposed to be mutated, we need to do
   * two things:
   * 1) ensure that the current mapping (or no mapping) is locked so that the mapping is not
   *    changed later (this would lead to inconsistent data). If the mapping state is not yet
   *    locked, the user is asked whether it is okay to lock it.
   *    If the user confirms this, the mapping is locked and we can continue with (2). If the
   *    user denies the locking request, the original bucket mutation will NOT be executed.
   * 2) volumeTracing.volumeBucketDataHasChanged will bet set to true if the user didn't
   *    deny the request for locking the mapping.
   */

  const { isMappingLockedIfNeeded } = yield* call(ensureMaybeActiveMappingIsLocked, volumeTracing);
  if (!isMappingLockedIfNeeded) {
    return false;
  }

  // Mark that bucket data has changed
  yield* put(setVolumeBucketDataHasChangedAction(volumeTracing.tracingId));
  return true;
}

export function* takeWithBatchActionSupport(actionType: Action["type"]) {
  // Some actions can be dispatched within a "batch" action OR without that.
  // takeWithBatchActionSupport is able to listen to actions in both cases.
  return yield* take([
    actionType,
    ((action: Action) => {
      if (!("meta" in action && action.meta.batch)) {
        return false;
      }
      return action.payload.find((subaction) => subaction.type === actionType) != null;
    }) as any,
  ]);
}

export function* spawnUntilCanceled<Fn extends (...args: any[]) => Saga<unknown>>(
  sagaFn: Fn,
  ...params: Parameters<Fn>
): Saga<void> {
  /*
   * Spawns the given saga with the given parameters in a non-blocking manner.
   * The saga is automatically canceled if a RESTART_SAGA or CANCEL_SAGA action
   * was dispatched.
   * If the spawned saga errors for some reason, that error will be escalated
   * so that WK as a whole will crash.
   * Always prefer spawnUntilCanceled over spawn unless you are very confident
   * that you need spawn. In general, we want to avoid spawn because it can cause
   * lingering sagas that never get teared down.
   */
  yield* spawn(function* (): Saga<void> {
    try {
      yield* race({
        completed: call(sagaFn, ...params),
        canceled: take(["RESTART_SAGA", "CANCEL_SAGA"]),
      });
    } catch (error) {
      yield* put(escalateErrorAction(error));
    }
  });
}

export function* takeEveryWithBatchActionSupport(
  actionType: Action["type"],
  saga: (...args: any[]) => any,
) {
  // Some actions can be dispatched within a "batch" action OR without that.
  // takeEveryWithBatchActionSupport is able to listen to actions in both cases.
  yield* takeEvery(actionType, saga);
  yield* takeEvery("*", function* handler(batchAction: Action) {
    if (!("meta" in batchAction && batchAction.meta.batch)) {
      return;
    }
    const actions = batchAction.payload;
    for (const action of actions) {
      if (action.type === actionType) {
        yield* fork(saga, action);
      }
    }
  });
}

const DEFAULT_WAIT_FOR_THROTTLE_MS = import.meta.env.MODE !== "test" ? 1000 : 100;

export function* waitFor(
  selector: (state: WebknossosState) => boolean,
  throttleMs: number = DEFAULT_WAIT_FOR_THROTTLE_MS,
): Saga<void> {
  // Waits for the specified selector to return true.
  // The selector is checked after each dispatched action (because
  // each action may have changed the store).
  // Too avoid performance problems, we wait for throttleMs after each
  // negative check.
  if (yield select(selector)) return;

  while (true) {
    if (import.meta.env.MODE !== "test") {
      // Actions are dispatched so often that it shouldn't be
      // necessary to do a race(take("*"), delay(X)) (see else-branch).
      yield take("*");
    } else {
      // In tests the assumption from above is not necessarily true.
      // Few actions are dispatched and we usually check for the expected
      // states quickly. So, we do the proper approach:
      yield* race([take("*"), delay(200)]);
    }
    if (yield select(selector)) return;
    yield delay(throttleMs);
  }
}
