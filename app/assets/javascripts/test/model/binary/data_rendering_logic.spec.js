// @flow

/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";

import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
} from "oxalis/model/binary/data_rendering_logic";

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
const volumeByteCount = 4;

test("calculateTextureSizeAndCountForLayer: grayscale data + minSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    grayscaleByteCount,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + midSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    grayscaleByteCount,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: grayscale data + betterSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    grayscaleByteCount,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + minSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    minSpecs,
    volumeByteCount,
  );
  t.is(textureSize, minSpecs.supportedTextureSize);
  t.is(textureCount, 3);
});

test("calculateTextureSizeAndCountForLayer: color data + midSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    midSpecs,
    volumeByteCount,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

test("calculateTextureSizeAndCountForLayer: color data + betterSpecs", t => {
  const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
    betterSpecs,
    volumeByteCount,
  );
  t.is(textureSize, midSpecs.supportedTextureSize);
  t.is(textureCount, 1);
});

const grayscaleLayer1 = { byteCount: grayscaleByteCount };
const grayscaleLayer2 = { byteCount: grayscaleByteCount };
const grayscaleLayer3 = { byteCount: grayscaleByteCount };

const volumeLayer1 = { byteCount: volumeByteCount };
const getByteCount = layer => layer.byteCount;

function testSupportFlags(t, supportFlags, expectedBasicSupport, expectedMappingSupport) {
  t.is(supportFlags.isBasicRenderingSupported, expectedBasicSupport);
  t.is(supportFlags.isMappingSupported, expectedMappingSupport);
}

function computeDataTexturesSetupCurried(spec, hasSegmentation): * {
  return layers => computeDataTexturesSetup(spec, layers, getByteCount, hasSegmentation);
}

test("Basic support (no segmentation): all specs", t => {
  // All specs should support up to three grayscale layers
  for (const spec of [minSpecs, midSpecs, betterSpecs]) {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(spec, false);
    testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1]), true, true);

    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2]),
      true,
      true,
    );

    testSupportFlags(
      t,
      computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, grayscaleLayer3]),
      true,
      true,
    );
  }
});

test("Basic support + volume: min specs", t => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(minSpecs, true);

  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), true, true);

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    true,
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
    false,
    false,
  );
});

test("Basic support + volume: mid specs", t => {
  const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(midSpecs, true);

  testSupportFlags(t, computeDataTexturesSetupPartial([grayscaleLayer1, volumeLayer1]), true, true);

  testSupportFlags(
    t,
    computeDataTexturesSetupPartial([grayscaleLayer1, grayscaleLayer2, volumeLayer1]),
    true,
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
    true,
    true,
  );
});
