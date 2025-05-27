import _ from "lodash";
import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { describe, it, expect } from "vitest";
import constants from "viewer/constants";
import type { ElementClass } from "types/api_types";

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

describe("calculateTextureSizeAndCountForLayer", () => {
  it("grayscale data + minSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      minSpecs,
      grayscaleElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(minSpecs.supportedTextureSize);
    expect(textureCount).toBe(1);
  });

  it("grayscale data + midSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      midSpecs,
      grayscaleElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(minSpecs.supportedTextureSize);
    expect(textureCount).toBe(1);
  });

  it("grayscale data + betterSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      betterSpecs,
      grayscaleElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(minSpecs.supportedTextureSize);
    expect(textureCount).toBe(1);
  });

  it("color data + minSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      minSpecs,
      volumeElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(minSpecs.supportedTextureSize);
    expect(textureCount).toBe(4);
  });

  it("color data + midSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      midSpecs,
      volumeElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(midSpecs.supportedTextureSize);
    expect(textureCount).toBe(1);
  });

  it("color data + betterSpecs", () => {
    const { textureSize, textureCount } = calculateTextureSizeAndCountForLayer(
      betterSpecs,
      volumeElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(textureSize).toBe(midSpecs.supportedTextureSize);
    expect(textureCount).toBe(1);
  });
});

type Layer = ReturnType<typeof createGrayscaleLayer>;

function testSupportFlags(
  supportFlags: ReturnType<typeof computeDataTexturesSetup>,
  expectedMaximumLayerCountToRender: number,
) {
  expect(supportFlags.maximumLayerCountToRender).toBe(expectedMaximumLayerCountToRender);
}

function computeDataTexturesSetupCurried(spec: typeof minSpecs, hasSegmentation: boolean) {
  return (layers: Layer[]) =>
    computeDataTexturesSetup(
      spec,
      layers as { elementClass: ElementClass; category: "color" | "segmentation" }[],
      hasSegmentation,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
}

describe("computeDataTexturesSetup", () => {
  it("Basic support (no segmentation): all specs", () => {
    // All specs should support up to three grayscale layers
    const specs: [typeof minSpecs, number][] = [
      [minSpecs, 7],
      [midSpecs, 15],
      [betterSpecs, 31],
    ];
    const hundredGrayscaleLayers = createLayers(100, 0);
    for (const [spec, expectedLayerCount] of specs) {
      const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(spec, false);
      testSupportFlags(computeDataTexturesSetupPartial(hundredGrayscaleLayers), expectedLayerCount);
      testSupportFlags(computeDataTexturesSetupPartial(hundredGrayscaleLayers), expectedLayerCount);
      testSupportFlags(computeDataTexturesSetupPartial(hundredGrayscaleLayers), expectedLayerCount);
    }
  });

  it("Basic support + volume: min specs", () => {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(minSpecs, true);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(10, 0)), 4);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(10, 1)), 1);
  });

  it("Basic support + volume: mid specs", () => {
    const computeDataTexturesSetupPartial = computeDataTexturesSetupCurried(midSpecs, true);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(20, 1)), 12);
    testSupportFlags(computeDataTexturesSetupPartial(createLayers(5, 1)), 6);
  });
});
