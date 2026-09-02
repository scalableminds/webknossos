import range from "lodash-es/range";
import type { ElementClass } from "types/api_types";
import constants, { getEffectiveBucketDepth } from "viewer/constants";
import {
  calculateTextureSizeAndCountForLayer,
  computeDataTexturesSetup,
  getBucketCapacity,
  getBucketHeightInTexture,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { describe, expect, it } from "vitest";

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

// A non-degenerate depth so these layers exercise the same (non-shrunk) bucket
// sizing as before the 2D bucket-footprint optimization was introduced.
const NON_DEGENERATE_DEPTH = 1000;
const createGrayscaleLayer = () => ({
  byteCount: grayscaleByteCount,
  elementClass: grayscaleElementClass,
  category: "color",
  boundingBox: { depth: NON_DEGENERATE_DEPTH },
});
const createVolumeLayer = () => ({
  byteCount: volumeByteCount,
  elementClass: volumeElementClass,
  category: "segmentation",
  boundingBox: { depth: NON_DEGENERATE_DEPTH },
});

function createLayers(grayscaleCount: number, volumeCount: number) {
  const grayscaleLayers = range(0, grayscaleCount).map(() => createGrayscaleLayer());
  const volumeLayers = range(0, volumeCount).map(() => createVolumeLayer());
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
      layers as {
        elementClass: ElementClass;
        category: "color" | "segmentation";
        boundingBox: { depth: number };
      }[],
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

describe("2D (degenerate-depth) layer bucket sizing", () => {
  it("getEffectiveBucketDepth returns 1 for a degenerate depth, BUCKET_WIDTH otherwise", () => {
    expect(getEffectiveBucketDepth(1)).toBe(1);
    expect(getEffectiveBucketDepth(0)).toBe(1);
    expect(getEffectiveBucketDepth(2)).toBe(constants.BUCKET_WIDTH);
    expect(getEffectiveBucketDepth(1000)).toBe(constants.BUCKET_WIDTH);
  });

  it("calculateTextureSizeAndCountForLayer never needs more total texture area for a 2D layer than for a regular layer", () => {
    const shrunkBucketVoxelCount = constants.BUCKET_WIDTH ** 2 * getEffectiveBucketDepth(1);
    const shrunk = calculateTextureSizeAndCountForLayer(
      midSpecs,
      grayscaleElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
      shrunkBucketVoxelCount,
    );
    const full = calculateTextureSizeAndCountForLayer(
      midSpecs,
      grayscaleElementClass,
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(shrunk.bucketVoxelCount).toBe(shrunkBucketVoxelCount);
    expect(full.bucketVoxelCount).toBe(constants.BUCKET_SIZE);
    expect(shrunk.textureSize * shrunk.textureSize * shrunk.textureCount).toBeLessThanOrEqual(
      full.textureSize * full.textureSize * full.textureCount,
    );
  });

  it("getBucketHeightInTexture clamps to a whole row when a bucket is smaller than the texture width", () => {
    const packingDegree = 4; // uint8
    const twoDBucketVoxelCount = 32 * 32 * 1;
    // packedBucketSize = 1024 / 4 = 256, well below a typical texture width.
    expect(getBucketHeightInTexture(2048, packingDegree, twoDBucketVoxelCount)).toBe(1);
    // The non-shrunk case stays unclamped (packedBucketSize = 8192 >= 4096).
    expect(getBucketHeightInTexture(4096, packingDegree, constants.BUCKET_SIZE)).toBe(2);
  });

  it("getBucketCapacity accounts for whole-row clamping so the reported capacity matches the real, addressable atlas space", () => {
    const packingDegree = 4;
    const twoDBucketVoxelCount = 32 * 32 * 1;
    const textureWidth = 2048;
    const capacity = getBucketCapacity(1, textureWidth, packingDegree, twoDBucketVoxelCount);
    // With clamping, each bucket occupies one full row, so capacity is bounded by
    // the number of rows (textureWidth), not by the much larger naive division
    // (textureWidth**2 / packedBucketSize), which would overcommit the atlas.
    expect(capacity).toBe(textureWidth);
  });
});
