// @flow

/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";

import { calculateTextureSizeAndCountForLayer } from "oxalis/model/binary/data_rendering_logic";

const minSpecs = {
  supportedTextureSize: 4096,
  maxTextureCount: 8,
};

const midSpecs = {
  supportedTextureSize: 8192,
  maxTextureCount: 8,
};

const betterSpecs = {
  supportedTextureSize: 16384,
  maxTextureCount: 8,
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
