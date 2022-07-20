import Store from "oxalis/store";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery } from "typed-redux-saga";
import type { ClipHistogramAction } from "oxalis/model/actions/settings_actions";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import Toast from "libs/toast";
import { OrthoViews } from "oxalis/constants";
import { getConstructorForElementClass } from "oxalis/model/bucket_data_handling/bucket";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import api from "oxalis/api/internal_api";
import { getRequestLogZoomStep } from "../accessors/flycam_accessor";

function onThresholdChange(layerName: string, [firstVal, secVal]: [number, number]) {
  if (firstVal < secVal) {
    Store.dispatch(updateLayerSettingAction(layerName, "intensityRange", [firstVal, secVal]));
  } else {
    Store.dispatch(updateLayerSettingAction(layerName, "intensityRange", [firstVal, secVal]));
  }
}

async function getClippingValues(layerName: string, thresholdRatio: number = 0.0001) {
  const { elementClass } = getLayerByName(Store.getState().dataset, layerName);
  const [TypedArrayClass] = getConstructorForElementClass(elementClass);

  // Find a viable resolution to compute the histogram on
  // Ideally, we want to avoid resolutions 1 and 2 to keep
  // the amount of data that has to be loaded small and
  // to de-noise the data
  const state = Store.getState();
  const maybeResolutionIndex = Math.max(2, getRequestLogZoomStep(state) + 1);

  const [cuboidXY, cuboidXZ, cuboidYZ] = await Promise.all([
    api.data.getViewportData(OrthoViews.PLANE_XY, layerName, maybeResolutionIndex),
    api.data.getViewportData(OrthoViews.PLANE_XZ, layerName, maybeResolutionIndex),
    api.data.getViewportData(OrthoViews.PLANE_YZ, layerName, maybeResolutionIndex),
  ]);
  const dataForAllViewPorts = new TypedArrayClass(
    cuboidXY.length + cuboidXZ.length + cuboidYZ.length,
  );
  dataForAllViewPorts.set(cuboidXY);
  dataForAllViewPorts.set(cuboidXZ, cuboidXY.length);
  dataForAllViewPorts.set(cuboidYZ, cuboidXY.length + cuboidXZ.length);
  const localHist = new Map();
  for (let i = 0; i < dataForAllViewPorts.length; i++) {
    if (dataForAllViewPorts[i] !== 0) {
      const value = localHist.get(dataForAllViewPorts[i]);
      localHist.set(dataForAllViewPorts[i], value != null ? value + 1 : 1);
    }
  }

  const sortedHistKeys = Array.from(localHist.keys()).sort((a, b) => a - b);
  const accumulator = new Map();
  let area = 0;

  for (const key of sortedHistKeys) {
    const value = localHist.get(key);
    area += value != null ? value : 0;
    accumulator.set(key, area);
  }

  const thresholdValue = (thresholdRatio * area) / 2.0;
  let lowerClip = -1;

  for (const key of sortedHistKeys) {
    const value = accumulator.get(key);

    if (value != null && value >= thresholdValue) {
      lowerClip = key;
      break;
    }
  }

  let upperClip = -1;

  for (const key of sortedHistKeys.reverse()) {
    const value = accumulator.get(key);

    if (value != null && value < area - thresholdValue) {
      upperClip = key;
      break;
    }
  }

  // largest brightness value is first after the keys were reversed
  const wiggleRoom = Math.floor(thresholdRatio * sortedHistKeys[0]);
  return [lowerClip, upperClip, wiggleRoom];
}

async function clipHistogram(action: ClipHistogramAction) {
  const [lowerClip, upperClip, wiggleRoom] = await getClippingValues(action.layerName);

  if (lowerClip === -1 || upperClip === -1) {
    Toast.warning(
      "The histogram could not be clipped, because the data did not contain any brightness values greater than 0.",
    );
    return;
  }

  if (!action.shouldAdjustClipRange) {
    onThresholdChange(action.layerName, [lowerClip, upperClip]);
  } else {
    onThresholdChange(action.layerName, [lowerClip, upperClip]);
    Store.dispatch(updateLayerSettingAction(action.layerName, "min", lowerClip - wiggleRoom));
    Store.dispatch(updateLayerSettingAction(action.layerName, "max", upperClip + wiggleRoom));
  }

  if (action.callback != null) {
    action.callback();
  }
}

export default function* listenToClipHistogramSaga(): Saga<void> {
  yield* takeEvery("CLIP_HISTOGRAM", clipHistogram);
}
