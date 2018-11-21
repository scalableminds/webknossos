// @flow
import { type EditableAnnotation, editAnnotation } from "admin/admin_rest_api";
import { type Saga, _takeEvery, call, select, take } from "oxalis/model/sagas/effect-generators";
import {
  isVolumeTracingDisallowed,
  displaysDownsampledVolumeData,
  isSegmentationMissingForZoomstep,
} from "oxalis/model/accessors/volumetracing_accessor";
import Model from "oxalis/model";
import Store from "oxalis/store";
import Toast from "libs/toast";
import constants from "oxalis/constants";
import messages from "messages";

export function* pushAnnotationUpdateAsync(): Saga<void> {
  const tracing = yield* select(state => state.tracing);

  // The extra type annotaton is needed here for flow
  const editObject: $Shape<EditableAnnotation> = {
    name: tracing.name,
    isPublic: tracing.isPublic,
    description: tracing.description,
  };
  yield* call(editAnnotation, tracing.annotationId, tracing.tracingType, editObject);
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

export function* warnAboutSegmentationOpacity(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const segmentationLayer = Model.getSegmentationLayer();
    if (!segmentationLayer) {
      return;
    }
    const isDisallowed = yield* select(isVolumeTracingDisallowed);
    const isSegmentationMissing = yield* select(state =>
      isSegmentationMissingForZoomstep(state, segmentationLayer.cube.MAX_ZOOM_STEP),
    );

    if (shouldDisplaySegmentationData() && (isDisallowed || isSegmentationMissing)) {
      Toast.error(messages["tracing.segmentation_zoom_warning"], { sticky: false, timeout: 3000 });
    } else {
      Toast.close(messages["tracing.segmentation_zoom_warning"]);
    }
    const displaysDownsampled = yield* select(state =>
      displaysDownsampledVolumeData(state, segmentationLayer.cube.MAX_UNSAMPLED_ZOOM_STEP),
    );
    if (shouldDisplaySegmentationData() && displaysDownsampled) {
      Toast.warning(messages["tracing.segmentation_downsampled_data_warning"]);
    } else {
      Toast.close(messages["tracing.segmentation_downsampled_data_warning"]);
    }
  }

  yield* take("INITIALIZE_SETTINGS");
  yield* warnMaybe();

  while (true) {
    yield* take([
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

export function* watchAnnotationAsync(): Saga<void> {
  yield _takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield _takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationUpdateAsync);
  yield _takeEvery("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
}
