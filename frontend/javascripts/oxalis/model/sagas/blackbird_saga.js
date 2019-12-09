// @flow
import { saveAs } from "file-saver";

import type { APIDataset } from "admin/api_flow_types";
import {
  changeActiveIsosurfaceCellAction,
  type ChangeActiveIsosurfaceCellAction,
} from "oxalis/model/actions/segmentation_actions";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { type FlycamAction, FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  type Saga,
  _takeEvery,
  call,
  put,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import window from "libs/window";
import * as tf from "@tensorflow/tfjs";
import api from "oxalis/api/internal_api";

async function train() {
  const bbox = {
    min: [0, 0, 0],
    max: [250, 250, 30],
  };
  const featureBankLayerName = api.data.getFeatureBankLayerName();
  if (!featureBankLayerName) {
    console.error("Couldn't find a layer with element class float32x16.");
    return;
  }
  const featureData = await api.data.getDataFor2DBoundingBox(featureBankLayerName, bbox);
  const labeledLayerName = await api.data.getVolumeTracingLayerName();
  const labeledData = await api.data.getDataFor2DBoundingBox(labeledLayerName, bbox);

  console.log("featureData", featureData);
  console.log("labeledData", labeledData);
}

function* trainClassifier(action): Saga<void> {
  console.log("train action");
  yield* call(train);
}

function* predict(action): Saga<void> {
  console.log("predict action");
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("PREDICT", predict);
  yield _takeEvery("TRAIN_CLASSIFIER", trainClassifier);
}
