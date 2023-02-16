import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import {
  EditAnnotationLayerAction,
  setAnnotationAllowUpdateAction,
  type SetOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";
import type { EditableAnnotation } from "admin/admin_rest_api";
import {
  editAnnotation,
  updateAnnotationLayer,
  acquireAnnotationMutex,
} from "admin/admin_rest_api";
import {
  SETTINGS_MAX_RETRY_COUNT,
  SETTINGS_RETRY_DELAY,
} from "oxalis/model/sagas/save_saga_constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  takeLatest,
  select,
  take,
  retry,
  delay,
  call,
  put,
  fork,
  takeEvery,
} from "typed-redux-saga";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { Model } from "oxalis/singletons";
import Store from "oxalis/store";
import Toast from "libs/toast";
import constants, { MappingStatusEnum } from "oxalis/constants";
import messages from "messages";
import { sleep } from "libs/utils";
import { APIUserCompact } from "types/api_flow_types";

/* Note that this must stay in sync with the back-end constant
  compare https://github.com/scalableminds/webknossos/issues/5223 */
const MAX_MAG_FOR_AGGLOMERATE_MAPPING = 16;
export function* pushAnnotationUpdateAsync() {
  const tracing = yield* select((state) => state.tracing);

  if (!tracing.restrictions.allowUpdate) {
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
    description: tracing.description,
    viewConfiguration,
  };
  yield* retry(
    SETTINGS_MAX_RETRY_COUNT,
    SETTINGS_RETRY_DELAY,
    editAnnotation,
    tracing.annotationId,
    tracing.annotationType,
    editObject,
  );
}

function* pushAnnotationLayerUpdateAsync(action: EditAnnotationLayerAction): Saga<void> {
  const { tracingId, layerProperties } = action;
  const annotationId = yield* select((storeState) => storeState.tracing.annotationId);
  const annotationType = yield* select((storeState) => storeState.tracing.annotationType);
  yield* retry(
    SETTINGS_MAX_RETRY_COUNT,
    SETTINGS_RETRY_DELAY,
    updateAnnotationLayer,
    annotationId,
    annotationType,
    tracingId,
    layerProperties,
  );
}

function shouldDisplaySegmentationData(): boolean {
  const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
  const canModeDisplaySegmentationData = constants.MODES_PLANE.includes(currentViewMode);
  const segmentationLayer = Model.getVisibleSegmentationLayer();

  if (!segmentationLayer || !canModeDisplaySegmentationData) {
    return false;
  }

  const segmentationLayerName = segmentationLayer.name;
  const isSegmentationLayerDisabled =
    Store.getState().datasetConfiguration.layers[segmentationLayerName].isDisabled;
  return !isSegmentationLayerDisabled;
}

export function* warnAboutSegmentationZoom(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const segmentationLayer = Model.getVisibleSegmentationLayer();

    if (!segmentationLayer) {
      return;
    }

    const isAgglomerateMappingEnabled = yield* select((storeState) => {
      if (!segmentationLayer) {
        return false;
      }

      const mappingInfo = getMappingInfo(
        storeState.temporaryConfiguration.activeMappingByLayer,
        segmentationLayer.name,
      );
      return (
        mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
        mappingInfo.mappingType === "HDF5"
      );
    });
    const isZoomThresholdExceeded = yield* select(
      (storeState) =>
        getRequestLogZoomStep(storeState) > Math.log2(MAX_MAG_FOR_AGGLOMERATE_MAPPING),
    );

    if (shouldDisplaySegmentationData() && isAgglomerateMappingEnabled && isZoomThresholdExceeded) {
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
      (action: Action) =>
        action.type === "UPDATE_LAYER_SETTING" &&
        action.layerName === segmentationLayerName &&
        action.propertyName === "alpha",
    ]);
    yield* warnMaybe();
  }
}
export function* watchAnnotationAsync(): Saga<void> {
  // Consuming the latest action here handles an offline scenario better.
  // If the user is offline and performs multiple changes to the annotation
  // name, only the latest action is relevant. If `_takeEvery` was used,
  // all updates to the annotation name would be retried regularily, which
  // would also cause race conditions.
  yield* takeLatest("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield* takeLatest("SET_ANNOTATION_VISIBILITY", pushAnnotationUpdateAsync);
  yield* takeLatest("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
  yield* takeLatest(
    (action: Action) =>
      action.type === "UPDATE_LAYER_SETTING" && action.propertyName === "isDisabled",
    pushAnnotationUpdateAsync,
  );
  yield* takeLatest("EDIT_ANNOTATION_LAYER", pushAnnotationLayerUpdateAsync);
}

export function* acquireAnnotationMutexMaybe(): Saga<void> {
  yield* take("WK_READY");
  // TODO: write tests.
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  const annotationId = yield* select((storeState) => storeState.tracing.annotationId);
  if (!allowUpdate) {
    return;
  }
  const othersMayEdit = yield* select((state) => state.tracing.othersMayEdit);
  const ONE_MINUTE = 1000 * 5;
  let isInitialRequest = true;
  let doesHaveMutex = false;
  let shallTryAcquireMutex = othersMayEdit;

  function onMutexStateChanged(canEdit: boolean, blockedByUser: APIUserCompact | null | undefined) {
    if (!canEdit) {
      const message =
        blockedByUser != null
          ? messages["annotation.acquiringMutexFailed"]({
              userName: `${blockedByUser.firstName} ${blockedByUser.lastName}`,
            })
          : messages["annotation.acquiringMutexFailed.noUser"];
      Toast.error(message, { sticky: true, key: "MutexCouldNotBeAcquired" });
    } else {
      Toast.close("MutexCouldNotBeAcquired");
      // TODO: Is refreshing the annotation needed? -> show toast that the user needs to reload the page or do it automatically
      if (!isInitialRequest) {
        Toast.success(messages["annotation.acquiringMutexSucceeded"]);
        location.reload();
      }
    }
  }

  function* tryAcquireMutex(): Saga<void> {
    while (shallTryAcquireMutex) {
      if (!doesHaveMutex) {
        yield* put(setAnnotationAllowUpdateAction(false));
      }
      try {
        const { canEdit, blockedByUser } = yield* call(acquireAnnotationMutex, annotationId);
        console.log({ canEdit, blockedByUser });
        yield* put(setAnnotationAllowUpdateAction(canEdit));
        if (canEdit !== doesHaveMutex || isInitialRequest) {
          doesHaveMutex = canEdit;
          onMutexStateChanged(canEdit, blockedByUser);
        }
      } catch (error) {
        if (doesHaveMutex == true || isInitialRequest) {
          onMutexStateChanged(false, null);
          yield* put(setAnnotationAllowUpdateAction(false));
        }
      }
      isInitialRequest = false;
      yield* delay(ONE_MINUTE);
    }
  }
  if (shallTryAcquireMutex) {
    yield* fork(tryAcquireMutex);
  }
  function* reactToOthersMayEditChanges({
    othersMayEdit,
  }: SetOthersMayEditForAnnotationAction): Saga<void> {
    shallTryAcquireMutex = othersMayEdit;
    if (shallTryAcquireMutex) {
      yield* call(tryAcquireMutex);
    } else {
      // The setting was edited. The person editing it should be able to edit the annotation.
      yield* put(setAnnotationAllowUpdateAction(true));
    }
  }
  // Fork saga and listen for changes on othersMayEdit
  function* listenForOthersMayEdit(): Saga<void> {
    yield* takeEvery("SET_OTHERS_MAY_EDIT_FOR_ANNOTATION", reactToOthersMayEditChanges);
  }
  yield* fork(listenForOthersMayEdit);
}
export default [warnAboutSegmentationZoom, watchAnnotationAsync, acquireAnnotationMutexMaybe];
