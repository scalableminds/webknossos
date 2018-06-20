// @flow
import Model from "oxalis/model";
import { take, takeEvery, call, select } from "redux-saga/effects";
import { editAnnotation } from "admin/admin_rest_api";
import messages from "messages";
import Toast from "libs/toast";
import {
  isVolumeTracingDisallowed,
  displaysDownsampledVolumeData,
  isSegmentationMissingForZoomstep,
} from "oxalis/model/accessors/volumetracing_accessor";
import constants from "oxalis/constants";
import Store from "oxalis/store";

export function* pushAnnotationUpdateAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  yield [
    call(editAnnotation, tracing.annotationId, tracing.tracingType, {
      name: tracing.name,
      isPublic: tracing.isPublic,
      description: tracing.description,
    }),
  ];
}

function shouldDisplaySegmentationData(): boolean {
  const { segmentationOpacity } = Store.getState().datasetConfiguration;
  if (segmentationOpacity === 0) {
    return false;
  }
  const currentViewMode = Store.getState().temporaryConfiguration.viewMode;

  // Currently segmentation data can only be displayed in orthogonal and volume mode
  const canModeDisplaySegmentationData = constants.MODES_PLANE.includes(currentViewMode);
  return Model.getSegmentationLayer() != null && canModeDisplaySegmentationData;
}

export function* warnAboutSegmentationOpacity(): Generator<*, *, *> {
  function* warnMaybe() {
    const segmentationLayer = Model.getSegmentationLayer();
    if (!segmentationLayer) {
      return;
    }
    const isDisallowed = yield select(isVolumeTracingDisallowed);
    const isSegmentationMissing = yield select(state =>
      isSegmentationMissingForZoomstep(state, segmentationLayer.cube.MAX_ZOOM_STEP),
    );

    if (shouldDisplaySegmentationData() && (isDisallowed || isSegmentationMissing)) {
      Toast.error(messages["tracing.segmentation_zoom_warning"], { sticky: false, timeout: 3000 });
    } else {
      Toast.close(messages["tracing.segmentation_zoom_warning"]);
    }
    const displaysDownsampled = yield select(state =>
      displaysDownsampledVolumeData(state, segmentationLayer.cube.MAX_UNSAMPLED_ZOOM_STEP),
    );
    if (shouldDisplaySegmentationData() && displaysDownsampled) {
      Toast.warning(messages["tracing.segmentation_downsampled_data_warning"]);
    } else {
      Toast.close(messages["tracing.segmentation_downsampled_data_warning"]);
    }
  }

  yield take("INITIALIZE_SETTINGS");
  yield* warnMaybe();

  while (true) {
    yield take([
      "ZOOM_IN",
      "ZOOM_OUT",
      "ZOOM_BY_DELTA",
      "SET_ZOOM_STEP",
      action =>
        action.type === "UPDATE_DATASET_SETTING" && action.propertyName === "segmentationOpacity",
    ]);
    yield* warnMaybe();
  }
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
}
