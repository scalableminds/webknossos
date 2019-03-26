// @flow
let segmentationModel = null;

export default async function predict(
  useGPU: boolean,
  tf: Object,
  buffer: ArrayBuffer,
  tileCounts: [number, number],
  inputExtent: number,
) {
  if (useGPU) {
    tf.setBackend("webgl");
  } else {
    tf.setBackend("cpu");
  }

  const tensorArray = new Float32Array(buffer);
  if (segmentationModel == null) {
    segmentationModel = await tf.loadLayersModel("/bundle/tf-models/seg-model.json", {
      strict: true,
    });
  }

  let tensor = tf.tensor4d(tensorArray, [
    tileCounts[0] * tileCounts[1],
    inputExtent,
    inputExtent,
    1,
  ]);
  tensor = tf.transpose(tensor, [0, 2, 1, 3]);

  const model = segmentationModel;
  const inferredTensor = model.predict(tensor);
  const data = await inferredTensor.data();
  return {
    data,
    shape: inferredTensor.shape,
  };
}
