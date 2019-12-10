// @flow
import * as tf from "@tensorflow/tfjs";
import * as _ from "lodash";

async function filterUnlabeledExamples(data, numClasses = 2) {
  const { xs: featuresReshaped, labels: labelsReshaped } = reshapeInputData(data);
  const mask = labelsReshaped.notEqual(0);
  const featuresFiltered = await tf.booleanMaskAsync(featuresReshaped, mask);
  const labelsFiltered = await tf.booleanMaskAsync(labelsReshaped, mask);
  const labelsFilteredRenorm = labelsFiltered.sub(tf.tensor1d([1], "int32"));
  const labelsFilteredOneHot = tf.oneHot(labelsFilteredRenorm, numClasses);
  // Dispose all unused tensors
  [featuresReshaped, labelsReshaped, mask, labelsFiltered].forEach(x => x.dispose());
  return { xs: featuresFiltered, labels: labelsFilteredOneHot };
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
  const batchSize = 2 ** 13;
  const validationSplit = 0.15;
  const trainEpochs = 50;
  const filteredTrainData = await filterUnlabeledExamples(trainData);
  const totalNumBatches = Math.ceil(
    (filteredTrainData.xs.shape[0] * (1 - validationSplit)) / batchSize,
  );

  console.log("Training model...");
  let trainBatchCount = 0;
  await model.fit(filteredTrainData.xs, filteredTrainData.labels, {
    batchSize,
    validationSplit,
    epochs: trainEpochs,
    shuffle: true,
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
  console.log("Training complete");
}

export async function predict(model, data) {
  const { xs } = reshapeInputData(data);
  const predictions = await model
    .predict(xs)
    // Convert 0-1 to 0-255
    .mul(255)
    .data();
  return new Uint8Array(predictions);
}
