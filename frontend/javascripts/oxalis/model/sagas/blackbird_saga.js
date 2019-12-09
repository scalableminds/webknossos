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
import { V3 } from "libs/mjs";

async function train() {
  try {
    const bbox = {
      min: [0, 0, 0],
      max: [250, 250, 30],
    };
    const featureChannelCount = 16;
    const size = V3.toArray(V3.sub(bbox.max, bbox.min));

    const featureBankLayerName = api.data.getFeatureBankLayerName();
    if (!featureBankLayerName) {
      console.error("Couldn't find a layer with element class float32x16.");
      return;
    }
    const featureData = await api.data.getDataFor2DBoundingBox(featureBankLayerName, bbox);
    const labeledLayerName = await api.data.getVolumeTracingLayerName();
    const labeledData = await api.data.getDataFor2DBoundingBox(labeledLayerName, bbox);

    let featureTensor = tf.tensor4d(featureData, size.concat([featureChannelCount]));
    let labeledTensor = tf.tensor4d(new Uint8Array(labeledData), size.concat([1]));

    console.log("featureData", featureTensor);
    console.log("labeledData", labeledTensor);
  } catch (exception) {
    console.error(exception);
  }
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
