// @flow
import { saveAs } from "file-saver";

import type { APIDataset } from "admin/api_flow_types";
import {
  changeActiveIsosurfaceCellAction,
  type ChangeActiveIsosurfaceCellAction,
} from "oxalis/model/actions/segmentation_actions";
import constants, { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { type FlycamAction, FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  getPosition,
  getPlaneExtentInVoxelFromStore,
} from "oxalis/model/accessors/flycam_accessor";
import Model from "oxalis/model";
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
import * as blackbirdModel from "oxalis/model/blackbird_model";

const numClasses = 2;
const featureChannelCount = 16;
const channelCount = 3;
const model = blackbirdModel.createModel(numClasses, featureChannelCount);
const bucketWidth = constants.BUCKET_WIDTH;

function writePrediction(position, value) {
  let predictionLayer = null;

  for (const layer of Object.values(api.data.model.dataLayers)) {
    if (layer.name == "prediction") {
      predictionLayer = layer;
    }
  }
  if (!predictionLayer) {
    console.error("No layer found with name `prediction`.");
    return;
  }
  const shape = [20, 20, 20];
  for (let x = position[0]; x < position[0] + shape[0]; x++) {
    for (let y = position[1]; y < position[1] + shape[1]; y++) {
      for (let z = position[2]; z < position[2] + shape[2]; z++) {
        for (let cidx = 0; cidx < channelCount; cidx++) {
          const voxelIdx =
            channelCount * x +
            cidx +
            y * (bucketWidth * channelCount) +
            z * channelCount * bucketWidth ** 2;
          predictionLayer.cube.labelVoxel([x, y, z], value[cidx], null, voxelIdx);
        }
      }
    }
  }
}

async function train() {
  // writePrediction([5, 5, 5], [255, 255, 0]);

  try {
    const bbox = {
      min: [0, 0, 0],
      max: [250, 250, 30],
    };
    const size = V3.toArray(V3.sub(bbox.max, bbox.min));
    const featureBankLayerName = api.data.getFeatureBankLayerName();

    if (!featureBankLayerName) {
      console.error("Couldn't find a layer with element class float32x16.");
      return;
    }
    const featureData = await api.data.getDataFor2DBoundingBox(featureBankLayerName, bbox);
    const labeledLayerName = await api.data.getVolumeTracingLayerName();
    const labeledData = await api.data.getDataFor2DBoundingBox(labeledLayerName, bbox);

    const featureTensor = tf.tensor4d(featureData, size.concat([featureChannelCount]));
    const labeledTensor = tf.tensor4d(new Uint8Array(labeledData), size.concat([1]));

    await blackbirdModel.train(
      model,
      {
        xs: featureTensor,
        labels: labeledTensor,
      },
      () => {
        console.log("iteration done");
      },
    );

    console.log("featureData", featureTensor);
    console.log("labeledData", labeledTensor);
  } catch (exception) {
    console.error(exception);
  }
}

function* trainClassifier(action): Saga<void> {
  console.log("train action");
  yield* call(train);
  yield* call(predict);
}

function getVoxelIndex(voxel: Vector3, channelIndex: number): number {
  // No `map` for performance reasons
  const voxelOffset = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    voxelOffset[i] = Math.floor(voxel[i]) % constants.BUCKET_WIDTH;
  }
  const voxelIndex =
    channelCount * voxelOffset[0] +
    channelIndex +
    voxelOffset[1] * (bucketWidth * channelCount) +
    voxelOffset[2] * channelCount * bucketWidth ** 2;
  return voxelIndex;
}

function* predict(action): Saga<void> {
  console.log("predict action");
  const position = yield* select(state => getPosition(state.flycam));
  const bbox = {
    min: [0, 0, Math.floor(position[2])],
    max: [250, 250, Math.floor(position[2] + 1)],
  };
  const size = V3.toArray(V3.sub(bbox.max, bbox.min));

  const colorLayerName = "prediction";
  const predictionCube = yield* call([Model, Model.getCubeByLayerName], colorLayerName);
  const featureBankLayerName = api.data.getFeatureBankLayerName();
  if (!featureBankLayerName) {
    console.error("Couldn't find a layer with element class float32x16.");
    return;
  }
  const featureData = yield* call(
    [api.data, api.data.getDataFor2DBoundingBox],
    featureBankLayerName,
    bbox,
  );
  const featureTensor = tf.tensor4d(featureData, size.concat([featureChannelCount]));
  const predictedData = yield* call(blackbirdModel.predict, model, { xs: featureTensor });

  console.log("Labeling in bounding box:", bbox);
  for (let x = 0; x <= size[0]; x++) {
    for (let y = 0; y <= size[1]; y++) {
      for (let z = 0; z <= size[2]; z++) {
        const predictionIndex =
          x * numClasses + y * size[0] * numClasses + z * size[0] * size[1] * numClasses;
        const channels = predictedData.slice(predictionIndex, predictionIndex + numClasses);
        // const maxChannel = Math.max(...channels);
        // const classId = channels.indexOf(maxChannel);
        const voxelPosition = [bbox.min[0] + x, bbox.min[1] + y, bbox.min[2] + z];
        // Hardcode channel 0 (foreground) and channel index 3 for blue
        const voxelIndex = getVoxelIndex(voxelPosition, 3);
        predictionCube.labelVoxel(voxelPosition, channels[0], null, voxelIndex);
      }
    }
  }
  console.log("Finished labeling.");
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("TRAIN_CLASSIFIER", trainClassifier);
  // yield _takeEvery("PREDICT", predict);
}
