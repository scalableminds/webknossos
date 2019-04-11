// @flow
let segmentationModel = null;

export default async function predict(
  useGPU: boolean,
  tf: Object,
  buffer: ArrayBuffer,
  inputExtent: number,
  isXYflipped: boolean,
) {
  if (useGPU) {
    tf.setBackend("webgl");
  } else {
    tf.setBackend("cpu");
  }

  const tensorArray = new Float32Array(buffer);
  if (segmentationModel == null) {
    segmentationModel = await tf.loadLayersModel("/assets/bundle/tf-models/seg-model.json", {
      strict: true,
    });
  }

  let tensor = tf.tensor4d(tensorArray, [1, inputExtent, inputExtent, 1]);
  // The tensorflow model expects a flipped x/y-axis
  if (!isXYflipped) {
    tensor = tf.transpose(tensor, [0, 2, 1, 3]);
  }

  const model = segmentationModel;
  const inferredTensor = model.predict(tensor);
  const data = await inferredTensor.data();
  tensor.dispose();
  inferredTensor.dispose();
  return data;
}
