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

async function train() {
  const cuboidData = await api.data.getDataFor2DBoundingBox("float32x16-layer", {
    min: [0, 0, 0],
    max: [100, 100, 100],
  });
  console.log("cuboidData", cuboidData);
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
