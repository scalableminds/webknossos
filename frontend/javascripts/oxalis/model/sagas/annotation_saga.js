// @flow
import { type EditableAnnotation, editAnnotation } from "admin/admin_rest_api";
import {
  type Saga,
  _takeEvery,
  call,
  select,
  take,
  _delay,
} from "oxalis/model/sagas/effect-generators";
import Model from "oxalis/model";
import Store from "oxalis/store";
import Toast from "libs/toast";
import constants from "oxalis/constants";
import messages from "messages";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";

/* Note that this must stay in sync with the back-end constant
  compare https://github.com/scalableminds/webknossos/issues/5223 */
const MAX_MAG_FOR_AGGLOMERATE_MAPPING = 16;

export function* pushAnnotationUpdateAsync(): Saga<void> {
  const tracing = yield* select(state => state.tracing);

  // The extra type annotaton is needed here for flow
  const editObject: $Shape<EditableAnnotation> = {
    name: tracing.name,
    visibility: tracing.visibility,
    description: tracing.description,
  };
  yield* call(editAnnotation, tracing.annotationId, tracing.annotationType, editObject);
}

function shouldDisplaySegmentationData(): boolean {
  const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
  const canModeDisplaySegmentationData = constants.MODES_PLANE.includes(currentViewMode);
  const segmentationLayer = Model.getVisibleSegmentationLayer();
  if (!segmentationLayer || !canModeDisplaySegmentationData) {
    return false;
  }
  const segmentationLayerName = segmentationLayer.name;
  const isSegmentationLayerDisabled = Store.getState().datasetConfiguration.layers[
    segmentationLayerName
  ].isDisabled;
  return !isSegmentationLayerDisabled;
}

export function* warnAboutSegmentationZoom(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const segmentationLayer = Model.getVisibleSegmentationLayer();
    if (!segmentationLayer) {
      return;
    }
    const isAgglomerateMappingEnabled = yield* select(storeState => {
      if (!segmentationLayer) {
        return false;
      }
      const mappingInfo = getMappingInfo(
        storeState.temporaryConfiguration.activeMappingByLayer,
        segmentationLayer.name,
      );
      return mappingInfo.isMappingEnabled && mappingInfo.mappingType === "HDF5";
    });

    const isZoomThresholdExceeded = yield* select(
      storeState => getRequestLogZoomStep(storeState) > Math.log2(MAX_MAG_FOR_AGGLOMERATE_MAPPING),
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
  yield _delay(5000);
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
      action =>
        action.type === "UPDATE_LAYER_SETTING" &&
        action.layerName === segmentationLayerName &&
        action.propertyName === "alpha",
    ]);
    yield* warnMaybe();
  }
}

export function* watchAnnotationAsync(): Saga<void> {
  yield _takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield _takeEvery("SET_ANNOTATION_VISIBILITY", pushAnnotationUpdateAsync);
  yield _takeEvery("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
}

export default [warnAboutSegmentationZoom, watchAnnotationAsync];
