import React from "react";
import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import {
  type EditAnnotationLayerAction,
  setAnnotationAllowUpdateAction,
  type SetAnnotationDescriptionAction,
  setBlockedByUserAction,
  type SetOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";
import type { EditableAnnotation } from "admin/admin_rest_api";
import type { ActionPattern } from "redux-saga/effects";
import { editAnnotation, acquireAnnotationMutex } from "admin/admin_rest_api";
import {
  SETTINGS_MAX_RETRY_COUNT,
  SETTINGS_RETRY_DELAY,
} from "oxalis/model/sagas/save_saga_constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  takeLatest,
  take,
  retry,
  delay,
  call,
  put,
  fork,
  takeEvery,
  cancel,
  cancelled,
} from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { getMappingInfo, is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import { getActiveMagIndexForLayer } from "oxalis/model/accessors/flycam_accessor";
import { Model } from "oxalis/singletons";
import Store from "oxalis/store";
import Toast from "libs/toast";
import constants, { MappingStatusEnum } from "oxalis/constants";
import messages from "messages";
import type { APIUserCompact } from "types/api_flow_types";
import { Button } from "antd";
import ErrorHandling from "libs/error_handling";
import { mayEditAnnotationProperties } from "../accessors/annotation_accessor";
import { determineLayout } from "oxalis/view/layouting/default_layout_configs";
import { getLastActiveLayout, getLayoutConfig } from "oxalis/view/layouting/layout_persistence";
import { is3dViewportMaximized } from "oxalis/view/layouting/flex_layout_helper";
import { needsLocalHdf5Mapping } from "../accessors/volumetracing_accessor";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import { updateAnnotationLayerName, updateMetadataOfAnnotation } from "./update_actions";

/* Note that this must stay in sync with the back-end constant MaxMagForAgglomerateMapping
  compare https://github.com/scalableminds/webknossos/issues/5223.
 */
const MAX_MAG_FOR_AGGLOMERATE_MAPPING = 16;

export function* pushAnnotationDescriptionUpdateAction(action: SetAnnotationDescriptionAction) {
  const mayEdit = yield* select((state) => mayEditAnnotationProperties(state));
  if (!mayEdit) {
    return;
  }
  yield* put(pushSaveQueueTransaction([updateMetadataOfAnnotation(action.description)]));
}

export function* pushAnnotationUpdateAsync(action: Action) {
  const tracing = yield* select((state) => state.tracing);
  const mayEdit = yield* select((state) => mayEditAnnotationProperties(state));
  if (!mayEdit) {
    return;
  }

  // Persist the visibility of each layer within the annotation-specific
  // viewConfiguration.
  const { layers } = yield* select((state) => state.datasetConfiguration);
  const viewConfiguration = {
    layers: _.mapValues(layers, (layer) => ({
      isDisabled: layer.isDisabled,
    })),
  };
  // The extra type annotation is needed here for flow
  const editObject: Partial<EditableAnnotation> = {
    name: tracing.name,
    visibility: tracing.visibility,
    viewConfiguration,
  };
  try {
    yield* retry(
      SETTINGS_MAX_RETRY_COUNT,
      SETTINGS_RETRY_DELAY,
      editAnnotation,
      tracing.annotationId,
      tracing.annotationType,
      editObject,
    );
  } catch (error) {
    // If the annotation cannot be saved repeatedly (retries will continue for 5 minutes),
    // we will only notify the user if the name, visibility or description could not be changed.
    // Otherwise, we won't notify the user and won't let the sagas crash as the actual skeleton/volume
    // tracings are handled separately.
    ErrorHandling.notify(error as Error);
    if (
      ["SET_ANNOTATION_NAME", "SET_ANNOTATION_VISIBILITY", "SET_ANNOTATION_DESCRIPTION"].includes(
        action.type,
      )
    ) {
      Toast.error("Could not update annotation property. Please try again.");
    }
    console.error(error);
  }
}

function* pushAnnotationLayerUpdateAsync(action: EditAnnotationLayerAction): Saga<void> {
  const { tracingId, layerProperties } = action;
  yield* put(
    pushSaveQueueTransaction([updateAnnotationLayerName(tracingId, layerProperties.name)]),
  );
}

function shouldDisplaySegmentationData(): boolean {
  const state = Store.getState();
  const currentViewMode = state.temporaryConfiguration.viewMode;
  const canModeDisplaySegmentationData = constants.MODES_PLANE.includes(currentViewMode);
  const segmentationLayer = Model.getVisibleSegmentationLayer();

  if (!segmentationLayer || !canModeDisplaySegmentationData) {
    return false;
  }

  const segmentationLayerName = segmentationLayer.name;
  const isSegmentationLayerDisabled =
    state.datasetConfiguration.layers[segmentationLayerName].isDisabled;
  if (isSegmentationLayerDisabled) {
    return false;
  }
  const is2d = is2dDataset(state.dataset);
  const controlMode = state.temporaryConfiguration.controlMode;
  const currentLayoutType = determineLayout(controlMode, currentViewMode, is2d);
  const lastActiveLayoutName = getLastActiveLayout(currentLayoutType);
  const layout = getLayoutConfig(currentLayoutType, lastActiveLayoutName);
  const onlyViewing3dViewport = is3dViewportMaximized(layout);
  return !onlyViewing3dViewport;
}

export function* warnAboutSegmentationZoom(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const segmentationLayer = Model.getVisibleSegmentationLayer();

    if (!segmentationLayer) {
      return;
    }

    const isRemoteAgglomerateMappingEnabled = yield* select((storeState) => {
      if (!segmentationLayer) {
        return false;
      }
      const mappingInfo = getMappingInfo(
        storeState.temporaryConfiguration.activeMappingByLayer,
        segmentationLayer.name,
      );
      return (
        mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
        mappingInfo.mappingType === "HDF5" &&
        !needsLocalHdf5Mapping(storeState, segmentationLayer.name)
      );
    });
    const isZoomThresholdExceeded = yield* select(
      (storeState) =>
        getActiveMagIndexForLayer(storeState, segmentationLayer.name) >
        Math.log2(MAX_MAG_FOR_AGGLOMERATE_MAPPING),
    );

    if (
      shouldDisplaySegmentationData() &&
      isRemoteAgglomerateMappingEnabled &&
      isZoomThresholdExceeded
    ) {
      Toast.error(messages["tracing.segmentation_zoom_warning_agglomerate"], {
        sticky: false,
        timeout: 3000,
      });
    } else {
      Toast.close(messages["tracing.segmentation_zoom_warning_agglomerate"]);
    }
  }

  yield* take("WK_READY");
  // Wait before showing the initial warning. Due to initialization lag it may only be visible very briefly, otherwise.
  yield* delay(5000);
  yield* warnMaybe();

  while (true) {
    const segmentationLayer = Model.getVisibleSegmentationLayer();
    const segmentationLayerName = segmentationLayer != null ? segmentationLayer.name : null;
    yield* take([
      "ZOOM_IN",
      "ZOOM_OUT",
      "ZOOM_BY_DELTA",
      "SET_ZOOM_STEP",
      "SET_STORED_LAYOUTS",
      "SET_MAPPING",
      "SET_MAPPING_ENABLED",
      "FINISH_MAPPING_INITIALIZATION",
      (action: Action) =>
        action.type === "UPDATE_LAYER_SETTING" &&
        action.layerName === segmentationLayerName &&
        action.propertyName === "alpha",
    ] as ActionPattern);
    yield* warnMaybe();
  }
}
export function* watchAnnotationAsync(): Saga<void> {
  // Consuming the latest action here handles an offline scenario better.
  // If the user is offline and performs multiple changes to the annotation
  // name, only the latest action is relevant. If `_takeEvery` was used,
  // all updates to the annotation name would be retried regularly, which
  // would also cause race conditions.
  yield* takeLatest(
    ["SET_ANNOTATION_NAME", "SET_ANNOTATION_VISIBILITY"],
    pushAnnotationUpdateAsync,
  );
  yield* takeLatest("SET_ANNOTATION_DESCRIPTION", pushAnnotationDescriptionUpdateAction);
  yield* takeLatest(
    ((action: Action) =>
      action.type === "UPDATE_LAYER_SETTING" &&
      action.propertyName === "isDisabled") as ActionPattern,
    pushAnnotationUpdateAsync,
  );
  yield* takeLatest("EDIT_ANNOTATION_LAYER", pushAnnotationLayerUpdateAsync);
}

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  yield* take("WK_READY");
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  const annotationId = yield* select((storeState) => storeState.tracing.annotationId);
  if (!allowUpdate) {
    return;
  }
  const othersMayEdit = yield* select((state) => state.tracing.othersMayEdit);
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
            {messages["annotation.acquiringMutexSucceeded"]}{" "}
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
export default [warnAboutSegmentationZoom, watchAnnotationAsync, acquireAnnotationMutexMaybe];
