import { Modal } from "antd";
import messages from "messages";
import type { Action } from "oxalis/model/actions/actions";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { ActiveMappingInfo, VolumeTracing } from "oxalis/store";
import { call, put, takeEvery } from "typed-redux-saga";
import Toast from "libs/toast";
import { Store } from "oxalis/singletons";
import { ActionPattern } from "@redux-saga/types";
import { setMappingIsLockedAction } from "../actions/volumetracing_actions";
import { MappingStatusEnum } from "oxalis/constants";

export function* takeEveryUnlessBusy<P extends ActionPattern>(
  actionDescriptor: P,
  saga: (arg0: Action) => Saga<void>,
  reason: string,
): Saga<void> {
  /*
   * Similar to takeEvery, this function can be used to react to
   * actions to start sagas. However, the difference is that once the given
   * saga is executed, webKnossos will be marked as busy. When being busy,
   * following actions which match the actionDescriptor are ignored.
   * When the given saga finishes, busy is set to false.
   *
   * Note that busyBlockingInfo is also used/respected in other places within
   * webKnossos.
   */
  function* sagaBusyWrapper(action: Action) {
    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(
        `Ignoring ${action.type} request (reason: ${busyBlockingInfo.reason || "null"})`,
      );
      return;
    }

    yield* put(setBusyBlockingInfoAction(true, reason));
    yield* call(saga, action);
    yield* put(setBusyBlockingInfoAction(false));
  }

  yield* takeEvery(actionDescriptor, sagaBusyWrapper);
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
          Store.dispatch(setMappingIsLockedAction());
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
        onCancel: async () => {
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
    activeMappingByLayer[volumeTracing.tracingId].mappingType === "HDF5";
  if (isSomeMappingActive && isHDF5Mapping) {
    try {
      return yield* call(askUserForLockingActiveMapping, volumeTracing, activeMappingByLayer);
    } catch (error: any) {
      return error as EnsureMappingIsLockedReturnType;
    }
  } else {
    yield* put(setMappingIsLockedAction());
    return { isMappingLockedIfNeeded: true, reason: "Locked that no mapping is active." };
  }
}

export default {};
