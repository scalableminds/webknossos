// @flow
import constants, { type Vector3 } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import Model from "oxalis/model";
import { type Saga, _takeEvery, call, select, take } from "oxalis/model/sagas/effect-generators";
import * as tf from "@tensorflow/tfjs";
import api from "oxalis/api/internal_api";
import Store from "oxalis/store";
import {
  setLiveTrainingProgressAction,
  setIsLiveTrainingPredictingAction,
} from "oxalis/model/actions/ui_actions";
import { V3 } from "libs/mjs";
import _ from "lodash";
import * as blackbirdModel from "oxalis/model/blackbird_model";
import * as Utils from "libs/utils";

const predictionWindow = 20;
const numClasses = 2;
const featureChannelCount = 16;
const channelCount = 3;
const model = blackbirdModel.createModel(numClasses, featureChannelCount);
const bucketWidth = constants.BUCKET_WIDTH;

async function train() {
  try {
    Store.dispatch(setLiveTrainingProgressAction(0.1));
    await Utils.sleep(10);
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
      (progressPercentage: number) => {
        Store.dispatch(setLiveTrainingProgressAction(progressPercentage));
      },
    );

    console.log("featureData", featureTensor);
    console.log("labeledData", labeledTensor);
  } catch (exception) {
    console.error(exception);
  }
}

function* trainClassifier(): Saga<void> {
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

function* predict(): Saga<void> {
  console.log("predict action");
  Store.dispatch(setIsLiveTrainingPredictingAction(true));
  yield* call([Utils, Utils.sleep], 10);
  const datasetBbox = yield* select(
    state => state.dataset.dataSource.dataLayers.find(layer => layer.name === "color").boundingBox,
  );
  const position = yield* select(state => getPosition(state.flycam));
  const bbox = {
    min: [
      datasetBbox.topLeft[0],
      datasetBbox.topLeft[1],
      _.clamp(
        Math.floor(position[2] - predictionWindow / 2),
        datasetBbox.topLeft[2],
        datasetBbox.topLeft[2] + datasetBbox.depth,
      ),
    ],
    max: [
      datasetBbox.topLeft[0] + datasetBbox.width,
      datasetBbox.topLeft[1] + datasetBbox.height,
      _.clamp(
        Math.floor(position[2] + predictionWindow / 2 + 1),
        datasetBbox.topLeft[2],
        datasetBbox.topLeft[2] + datasetBbox.depth,
      ),
    ],
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
  console.time("prediction");
  const predictedData = yield* call(blackbirdModel.predict, model, { xs: featureTensor });
  console.timeEnd("prediction");

  console.log("Labeling in bounding box:", bbox);
  console.time("labeling");
  let timeForLabelVoxel = 0;
  for (let x = 0; x <= size[0]; x++) {
    for (let y = 0; y <= size[1]; y++) {
      for (let z = 0; z <= size[2]; z++) {
        const predictionIndex =
          x * numClasses + y * size[0] * numClasses + z * size[0] * size[1] * numClasses;
        const channels = predictedData.slice(predictionIndex, predictionIndex + numClasses);
        // const maxChannel = Math.max(...channels);
        // const classId = channels.indexOf(maxChannel);
        const voxelPosition = [bbox.min[0] + x, bbox.min[1] + y, bbox.min[2] + z];
        channels.forEach((value, cidx) => {
          const voxelIndex = getVoxelIndex(voxelPosition, cidx);
          predictionCube.labelVoxel(voxelPosition, value, null, voxelIndex);
        });
      }
    }
  }
  console.timeEnd("labeling");
  Store.dispatch(setIsLiveTrainingPredictingAction(false));
  console.log("Finished labeling.");
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("TRAIN_CLASSIFIER", trainClassifier);
  yield _takeEvery("PREDICT", predict);
}
