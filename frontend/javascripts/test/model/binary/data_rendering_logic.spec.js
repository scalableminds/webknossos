// @flow

import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import test from "ava";
import constants from "oxalis/constants";

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

test("calculateTextureSizeAndCountForLayer: grayscale data + minSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + midSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + betterSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    grayscaleByteCount,
    grayscaleElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + minSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 3);
});

test("calculateTextureSizeAndCountForLayer: color data + midSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + betterSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    volumeByteCount,
    volumeElementClass,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

const grayscaleLayer1 = { byteCount: grayscaleByteCount, elementClass: grayscaleElementClass };
const grayscaleLayer2 = { byteCount: grayscaleByteCount, elementClass: grayscaleElementClass };
const grayscaleLayer3 = { byteCount: grayscaleByteCount, elementClass: grayscaleElementClass };

const volumeLayer1 = { byteCount: volumeByteCount, elementClass: volumeElementClass };
const getByteCount = layer => layer.byteCount;

function testSupportFlags(
  t,
  supportFlags,
  expectedMaximumLayerCountToRender,
  expectedMappingSupport,
) {
  t.is(supportFlags.maximumLayerCountToRender, expectedMaximumLayerCountToRender);
  t.is(supportFlags.isMappingSupported, expectedMappingSupport);
}

function computeDataTexturesSetupCurried(spec, hasSegmentation): * {
  return layers =>
    computeDataTexturesSetup(
      spec,
      layers,
      getByteCount,
      hasSegmentation,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
}

test("Basic support (no segmentation): all specs", t => {
  // All specs should support up to three grayscale layers
  for (const [spec, expectedLayerCount] of [[minSpecs, 4], [midSpecs, 8], [betterSpecs, 16]]) {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(spec, false);
    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1]),
      expectedLayerCount,
      true,
    );

    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2]),
      expectedLayerCount,
      true,
    );

    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, grayscaleLayer3]),
      expectedLayerCount,
      true,
    );
  }
});

test("Basic support + volume: min specs", t => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(minSpecs, true);

  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), 2, false);

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    2,
    false,
  );

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([
      grayscaleLayer1,
      grayscaleLayer2,
      grayscaleLayer3,
      volumeLayer1,
    ]),
    2,
    false,
  );
});

test("Basic support + volume: mid specs", t => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(midSpecs, true);

  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), 8, true);

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    8,
    true,
  );

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([
      grayscaleLayer1,
      grayscaleLayer2,
      grayscaleLayer3,
      volumeLayer1,
    ]),
    8,
    true,
  );
});
