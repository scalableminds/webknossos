// @flow
import * as tf from "@tensorflow/tfjs";
import _ from "lodash";

function computeClassWeight(trainData) {
  const classWeight = [];
  const [length, numClasses] = trainData.labels.shape;
  // Sum up the 1s of each column, because the labels are one-hot encoded
  const classCountTensor = trainData.labels.sum(0).dataSync();
  for (let i = 0; i < numClasses; i++) {
    const classCount = classCountTensor[i];
    classWeight[i] = classCount === 0 ? 1 : length / classCount / numClasses;
  }
  return classWeight;
}

function filterUnlabeledExamples(data, numClasses = 2) {
  return tf.tidy(() => {
    const { xs: featuresReshaped, labels: labelsReshaped } = reshapeInputData(data);
    const mask = labelsReshaped.dataSync();
    const indices = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) {
        indices.push(i);
      }
    }
    const featuresFiltered = tf.gather(featuresReshaped, indices);
    const labelsFiltered = tf.gather(labelsReshaped, indices);
    const labelsFilteredRenorm = labelsFiltered.sub(tf.tensor1d([1], "int32"));
    const labelsFilteredOneHot = tf.oneHot(labelsFilteredRenorm, numClasses);
    return { xs: featuresFiltered, labels: labelsFilteredOneHot };
  });
}

export function createModel(numClasses, numFeatures) {
  const model = tf.sequential();
  const initializer = "glorotUniform";
  const activation = "relu";
  model.add(
    tf.layers.dense({
      inputShape: [numFeatures],
      units: 32,
      activation,
      initializer,
    }),
  );
  model.add(
    tf.layers.dense({
      units: 16,
      activation,
      initializer,
    }),
  );
  model.add(tf.layers.dense({ units: numClasses, activation: "softmax" }));
  return model;
}

function reshapeInputData(data) {
  const { xs, labels } = data;
  return {
    xs: xs.reshape([-1, xs.shape[xs.shape.length - 1]]),
    ...(labels != null ? { labels: labels.reshape([-1]) } : {}),
  };
}

export async function train(model, trainData, onIteration: (progress: number) => void) {
  console.log("Preparing data for training...");
  const optimizer = "adam";
  model.compile({
    optimizer,
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
  const filteredTrainDataSorted = await filterUnlabeledExamples(trainData);
  const inds = tf.util.createShuffledIndices(filteredTrainDataSorted.labels.shape[0]);
  const shuffledIndices = tf.tensor1d(new Int32Array(inds));
  const filteredTrainData = {
    xs: tf.gather(filteredTrainDataSorted.xs, shuffledIndices),
    labels: tf.gather(filteredTrainDataSorted.labels, shuffledIndices),
  };
  const classWeight = computeClassWeight(filteredTrainData);
  const batchSize = filteredTrainData.xs.size;
  const validationSplit = 0.1;
  const trainEpochs = 250;
  const totalNumBatches = Math.ceil(
    (filteredTrainData.xs.shape[0] * (1 - validationSplit)) / batchSize,
  );

  console.log("Training model...");
  let trainBatchCount = 0;
  console.time("training");
  await model.fit(filteredTrainData.xs, filteredTrainData.labels, {
    batchSize,
    validationSplit,
    epochs: trainEpochs,
    shuffle: true,
    classWeight,
    callbacks: {
      onBatchEnd: async batch => {
        trainBatchCount++;
        const progressPercentage = _.round(
          (trainBatchCount / (totalNumBatches * trainEpochs)) * 100,
          1,
        );
        // console.log(`Batch (${batch + 1}/${totalNumBatches})`);
        if (onIteration && batch % 10 === 0) {
          onIteration(progressPercentage);
        }
        await tf.nextFrame();
      },
      onEpochEnd: async (epoch, logs) => {
        console.log(
          `Epoch (${epoch + 1}/${trainEpochs})`,
          "acc=",
          _.round(logs.acc, 3),
          "loss=",
          _.round(logs.loss, 3),
          "val_acc=",
          _.round(logs.val_acc, 3),
          "val_loss=",
          _.round(logs.val_loss, 3),
        );
        if (onIteration) {
          const progressPercentage = _.round(((epoch + 1) / trainEpochs) * 100, 1);
          onIteration(progressPercentage);
        }
        await tf.nextFrame();
      },
    },
  });
  console.timeEnd("training");
  console.log("Training complete");
}

export async function predict(model, data) {
  const batchSize = data.xs.size;
  const { xs } = reshapeInputData(data);
  const predictions = await model
    .predict(xs, { batchSize })
    // Convert 0-1 to 0-255
    .mul(255)
    .data();
  return new Uint8Array(predictions);
}
