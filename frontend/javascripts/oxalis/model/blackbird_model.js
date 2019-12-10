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
  console.log("Training model...");
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
  const totalNumBatches =
    Math.ceil((filteredTrainData.xs.shape[0] * (1 - validationSplit)) / batchSize) * trainEpochs;
  let trainBatchCount = 0;
  let valAcc;
  await model.fit(filteredTrainData.xs, filteredTrainData.labels, {
    batchSize,
    validationSplit,
    epochs: trainEpochs,
    shuffle: true,
    callbacks: {
      onBatchEnd: async (batch, logs) => {
        trainBatchCount++;
        const progressPercentage = _.round((trainBatchCount / totalNumBatches) * 100, 1);
        console.log(
          "Training... (" +
            `${progressPercentage}%` +
            ` complete of ${totalNumBatches} batches). To stop training, refresh or close page.`,
        );
        // plotLoss(trainBatchCount, logs.loss, "train");
        // plotAccuracy(trainBatchCount, logs.acc, "train");
        if (onIteration && batch % 10 === 0) {
          onIteration(progressPercentage);
        }
        await tf.nextFrame();
      },
      onEpochEnd: async (epoch, logs) => {
        valAcc = logs.val_acc;
        // plotLoss(trainBatchCount, logs.val_loss, "validation");
        // plotAccuracy(trainBatchCount, logs.val_acc, "validation");
        if (onIteration) {
          const progressPercentage = _.round(((epoch + 1) / trainEpochs) * 100, 1);
          onIteration(progressPercentage);
        }
        await tf.nextFrame();
      },
    },
  });
  const finalValAccPercent = valAcc * 100;
  console.log(`Final validation accuracy: ${finalValAccPercent.toFixed(1)}%; `);
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
