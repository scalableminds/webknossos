import test, { type ExecutionContext } from "ava";
import _ from "lodash";
import constants from "oxalis/constants";
import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import type { ElementClass } from "types/api_flow_types";

const { GPU_FACTOR_MULTIPLIER, DEFAULT_GPU_MEMORY_FACTOR } = constants;
const DEFAULT_REQUIRED_BUCKET_CAPACITY = GPU_FACTOR_MULTIPLIER * DEFAULT_GPU_MEMORY_FACTOR;
const minSpecs = {
  supportedTextureSize: 4096,
  maxTextureCount: 8,
};
const midSpecs = {
  supportedTextureSize: 8192,
  maxTextureCount: 16,
};
const betterSpecs = {
  supportedTextureSize: 16384,
  maxTextureCount: 32,
};
const grayscaleByteCount = 1;
const grayscaleElementClass = "uint8";
const volumeByteCount = 4;
const volumeElementClass = "uint32";

/*
 * The current rendering logic in WK only allows
 * as many layers as necessary. This is done to avoid
 * that the shaders are compiled for N layers even though
 * N layers will never be rendered at the same time (because
 * only one segmentation layer can be rendered at a time).
 * For that reason, testing the specs has to be done with a
 * sufficiently large amount of layers. To achieve this,
 * the helper function createLayers is used.
 */

const createGrayscaleLayer = () => ({
  byteCount: grayscaleByteCount,
  elementClass: grayscaleElementClass,
  category: "color",
});
const createVolumeLayer = () => ({
  byteCount: volumeByteCount,
  elementClass: volumeElementClass,
  category: "segmentation",
});

function createLayers(grayscaleCount: number, volumeCount: number) {
  const grayscaleLayers = _.range(0, grayscaleCount).map(() => createGrayscaleLayer());
  const volumeLayers = _.range(0, volumeCount).map(() => createVolumeLayer());
  return grayscaleLayers.concat(volumeLayers);
}

test("calculateTextureSizeAndCountForLayer: grayscale data + minSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + midSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + betterSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + minSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 4);
});

test("calculateTextureSizeAndCountForLayer: color data + midSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + betterSpecs", (t) => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

type Layer = ReturnType<typeof createGrayscaleLayer>;

const getByteCount = (layer: Layer) => layer.byteCount;

function testSupportFlags(
  t: ExecutionContext,
  supportFlags: ReturnType<typeof computeDataTexturesSetup>,
  expectedMaximumLayerCountToRender: number,
) {
  t.is(supportFlags.maximumLayerCountToRender, expectedMaximumLayerCountToRender);
}

function computeDataTexturesSetupCurried(spec: typeof minSpecs, hasSegmentation: boolean) {
  return (layers: Layer[]) =>
    computeDataTexturesSetup(
      spec,
      layers as { elementClass: ElementClass; category: "color" | "segmentation" }[],
      getByteCount as any,
      hasSegmentation,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
}

test("Basic support (no segmentation): all specs", (t) => {
  // All specs should support up to three grayscale layers
  const specs: [typeof minSpecs, number][] = [
    [minSpecs, 7],
    [midSpecs, 15],
    [betterSpecs, 31],
  ];
  const hundredGrayscaleLayers = createLayers(100, 0);
  for (const [spec, expectedLayerCount] of specs) {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(spec, false);
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial(hundredGrayscaleLayers),
      expectedLayerCount,
    );
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial(hundredGrayscaleLayers),
      expectedLayerCount,
    );
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial(hundredGrayscaleLayers),
      expectedLayerCount,
    );
  }
});

test("Basic support + volume: min specs", (t) => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(minSpecs, true);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(10, 0)), 4);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
});

test("Basic support + volume: mid specs", (t) => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(midSpecs, true);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(20, 1)), 12);
  testSupportFlags(t, computeDataTexturesSetupPartial(createLayers(5, 1)), 6);
});
