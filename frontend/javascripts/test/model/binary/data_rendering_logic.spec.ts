import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import test, { ExecutionContext } from "ava";
import constants from "oxalis/constants";
import { ElementClass } from "types/api_flow_types";

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
const grayscaleLayer1 = {
  byteCount: grayscaleByteCount,
  elementClass: grayscaleElementClass,
};
const grayscaleLayer2 = {
  byteCount: grayscaleByteCount,
  elementClass: grayscaleElementClass,
};
const grayscaleLayer3 = {
  byteCount: grayscaleByteCount,
  elementClass: grayscaleElementClass,
};
const volumeLayer1 = {
  byteCount: volumeByteCount,
  elementClass: volumeElementClass,
};

type Layer = typeof grayscaleLayer1;

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
      layers as { elementClass: ElementClass }[],
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
  for (const [spec, expectedLayerCount] of specs) {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(spec, false);
    testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1]), expectedLayerCount);
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2]),
      expectedLayerCount,
    );
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, grayscaleLayer3]),
      expectedLayerCount,
    );
  }
});

test("Basic support + volume: min specs", (t) => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(minSpecs, true);
  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2]), 4);
  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), 1);
  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    1,
  );
  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([
      grayscaleLayer1,
      grayscaleLayer2,
      grayscaleLayer3,
      volumeLayer1,
    ]),
    1,
  );
});

test("Basic support + volume: mid specs", (t) => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(midSpecs, true);
  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), 12);
  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    12,
  );
  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([
      grayscaleLayer1,
      grayscaleLayer2,
      grayscaleLayer3,
      volumeLayer1,
    ]),
    12,
  );
});
