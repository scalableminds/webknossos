import max from "lodash-es/max";
import memoize from "lodash-es/memoize";
import min from "lodash-es/min";
import {
  ByteType,
  FloatType,
  type PixelFormat,
  type PixelFormatGPU,
  RGBAFormat,
  RGIntegerFormat,
  ShortType,
  type TextureDataType,
  UnsignedByteType,
  UnsignedShortType,
} from "three";
import type { AdditionalAxis, ElementClass } from "types/api_types";
import constants, { getEffectiveBucketDepth, usesTRecycling } from "viewer/constants";
import type { TypedArrayConstructor } from "../helpers/typed_buffer";

export type GpuSpecs = {
  supportedTextureSize: number;
  maxTextureCount: number;
};
const lookupTextureCount = 1;
export type DataTextureSizeAndCount = {
  textureSize: number;
  textureCount: number;
  packingDegree: number;
  // The number of voxels a single bucket occupies in this layer's atlas. Equal to
  // constants.BUCKET_SIZE, unless the layer has a degenerate (e.g., z-extent-1) axis,
  // in which case buckets are packed with a smaller footprint. See getEffectiveBucketDepth.
  bucketVoxelCount: number;
};

// A data texture is a flat 2D atlas in which each bucket occupies a whole number of texture
// rows; a row is never shared by two buckets. Layers with a small bucket footprint (e.g. 2D)
// pack into less than one row and get rounded up, wasting the remainder — supporting several
// buckets per row would be possible future work.
export function getBucketHeightInTexture(
  textureWidth: number,
  packingDegree: number,
  bucketVoxelCount: number = constants.BUCKET_SIZE,
): number {
  const packedBucketSize = bucketVoxelCount / packingDegree;
  return Math.max(1, packedBucketSize / textureWidth);
}

export function getBucketsPerTexture(
  textureWidth: number,
  packingDegree: number,
  bucketVoxelCount: number = constants.BUCKET_SIZE,
): number {
  return textureWidth / getBucketHeightInTexture(textureWidth, packingDegree, bucketVoxelCount);
}

export function getBucketCapacity(
  dataTextureCount: number,
  textureWidth: number,
  packingDegree: number,
  bucketVoxelCount: number = constants.BUCKET_SIZE,
): number {
  const theoreticalBucketCapacity =
    dataTextureCount * getBucketsPerTexture(textureWidth, packingDegree, bucketVoxelCount);
  // RAM-wise we already impose a limit of how many buckets should be held. This limit
  // should not be exceeded.
  return Math.min(constants.MAXIMUM_BUCKET_COUNT_PER_LAYER, theoreticalBucketCapacity);
}

const BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY = 4;
// Keeps layers from getting so few buckets that they constantly reload.
const MINIMUM_BUCKET_CAPACITY_PER_LAYER = 128;

// A fixed per-layer budget would make memory grow with the layer count (e.g.
// 22 layers can exhaust GPU memory). Instead, the budget of
// BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY layers is the total, split evenly
// when there are more layers than that.
function scalePerLayerBudgetByLayerCount(
  perLayerBudgetAtBaseline: number,
  layerCount: number,
): number {
  if (layerCount <= BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY) {
    return perLayerBudgetAtBaseline;
  }
  const totalBudget = perLayerBudgetAtBaseline * BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY;
  return Math.max(MINIMUM_BUCKET_CAPACITY_PER_LAYER, Math.floor(totalBudget / layerCount));
}

// Capped at the RAM limit, because the DataCube can't free buckets that are
// picked for rendering.
export function getRequiredBucketCapacityPerLayer(
  gpuMemoryFactor: number,
  layerCount: number,
): number {
  return Math.min(
    scalePerLayerBudgetByLayerCount(constants.GPU_FACTOR_MULTIPLIER * gpuMemoryFactor, layerCount),
    getBucketCountSoftLimitPerLayer(layerCount),
  );
}

// Same scaling for the number of buckets a DataCube keeps in RAM.
export function getBucketCountSoftLimitPerLayer(layerCount: number): number {
  return scalePerLayerBudgetByLayerCount(constants.MAXIMUM_BUCKET_COUNT_PER_LAYER, layerCount);
}

// Must go through getBucketsPerTexture rather than dividing the required voxels by the
// texture's voxel area: a sub-row bucket's row padding cannot hold another bucket, so
// area-based sizing would pick a texture too small for requiredBucketCapacity buckets.
function getDataTextureCount(
  textureSize: number,
  packingDegree: number,
  requiredBucketCapacity: number,
  bucketVoxelCount: number = constants.BUCKET_SIZE,
) {
  return Math.ceil(
    requiredBucketCapacity / getBucketsPerTexture(textureSize, packingDegree, bucketVoxelCount),
  );
}

// Only exported for testing
export function calculateTextureSizeAndCountForLayer(
  specs: GpuSpecs,
  elementClass: ElementClass,
  requiredBucketCapacity: number,
  bucketVoxelCount: number = constants.BUCKET_SIZE,
): DataTextureSizeAndCount {
  let textureSize = specs.supportedTextureSize;
  const { packingDegree } = getDtypeConfigForElementClass(elementClass);

  // Try to half the texture size as long as it does not require more
  // data textures. This ensures that we maximize the number of simultaneously
  // renderable layers.
  while (
    getDataTextureCount(textureSize / 2, packingDegree, requiredBucketCapacity, bucketVoxelCount) <=
    getDataTextureCount(textureSize, packingDegree, requiredBucketCapacity, bucketVoxelCount)
  ) {
    textureSize /= 2;
  }

  const textureCount = getDataTextureCount(
    textureSize,
    packingDegree,
    requiredBucketCapacity,
    bucketVoxelCount,
  );
  return {
    textureSize,
    textureCount,
    packingDegree,
    bucketVoxelCount,
  };
}

function buildTextureInformationMap<
  Layer extends {
    elementClass: ElementClass;
    category: "color" | "segmentation";
    boundingBox: { depth: number };
    additionalAxes: Array<AdditionalAxis> | null;
    // Set for layers backed by a volume tracing (see APISegmentationLayer). Needed here
    // because atlas sizing has to make the same t-recycling decision the runtime does.
    tracingId?: string;
  },
>(
  layers: Array<Layer>,
  specs: GpuSpecs,
  requiredBucketCapacity: number,
): Map<Layer, DataTextureSizeAndCount> {
  const textureInformationPerLayer = new Map();
  layers.forEach((layer) => {
    const hasTAxis = layer.additionalAxes?.some((axis) => axis.name === "t") ?? false;
    // A t-recycling layer needs its atlas sized for full-depth buckets despite being
    // z-degenerate, hence the shared helper.
    const bucketVoxelCount = usesTRecycling(
      layer.boundingBox.depth,
      hasTAxis,
      layer.tracingId != null,
    )
      ? constants.BUCKET_SIZE
      : constants.BUCKET_SIZE_2D *
        getEffectiveBucketDepth(layer.boundingBox.depth, layer.tracingId != null);
    const sizeAndCount = calculateTextureSizeAndCountForLayer(
      specs,
      layer.elementClass,
      requiredBucketCapacity,
      bucketVoxelCount,
    );
    textureInformationPerLayer.set(layer, sizeAndCount);
  });
  return textureInformationPerLayer;
}

function getSmallestCommonBucketCapacity<
  Layer extends {
    elementClass: ElementClass;
  },
>(textureInformationPerLayer: Map<Layer, DataTextureSizeAndCount>): number {
  const capacities = Array.from(textureInformationPerLayer.values()).map((sizeAndCount) =>
    getBucketCapacity(
      sizeAndCount.textureCount,
      sizeAndCount.textureSize,
      sizeAndCount.packingDegree,
      sizeAndCount.bucketVoxelCount,
    ),
  );
  return min(capacities) || 0;
}

function getRenderSupportedLayerCount<
  Layer extends {
    elementClass: ElementClass;
    category: "color" | "segmentation";
  },
>(
  specs: GpuSpecs,
  textureInformationPerLayer: Map<Layer, DataTextureSizeAndCount>,
  hasSegmentation: boolean,
) {
  // Find out which layer needs the most textures. We assume that value is equal for all layers
  // so that we can tell the user that X layers can be rendered simultaneously. We could be more precise
  // here (because some layers might need fewer textures), but this would be harder to communicate to
  // the user and also more complex to maintain code-wise.
  const maximumTextureCountForLayer =
    max(
      Array.from(textureInformationPerLayer.values()).map(
        (sizeAndCount) => sizeAndCount.textureCount,
      ),
    ) ?? 0;

  // If a segmentation layer exists, we need to allocate a texture for custom colors,
  // and two for mappings.
  const textureCountForSegmentation = hasSegmentation ? 3 : 0;
  const maximumLayerCountToRender = Math.floor(
    (specs.maxTextureCount - textureCountForSegmentation - lookupTextureCount) /
      maximumTextureCountForLayer,
  );

  return {
    maximumLayerCountToRender: Math.min(maximumLayerCountToRender, textureInformationPerLayer.size),
    maximumTextureCountForLayer,
  };
}

export type LayerLike = {
  elementClass: ElementClass;
  category: "color" | "segmentation";
  boundingBox: { depth: number };
  additionalAxes: Array<AdditionalAxis> | null;
  tracingId?: string;
};

export function computeDataTexturesSetup<Layer extends LayerLike>(
  specs: GpuSpecs,
  layers: Array<Layer>,
  hasSegmentation: boolean,
  requiredBucketCapacity: number,
) {
  const textureInformationPerLayer = buildTextureInformationMap(
    layers,
    specs,
    requiredBucketCapacity,
  );
  // The textures are rounded up and may hold more buckets than required, but
  // TextureBucketManager uses at most requiredBucketCapacity.
  const smallestCommonBucketCapacity = Math.min(
    getSmallestCommonBucketCapacity(textureInformationPerLayer),
    requiredBucketCapacity,
  );
  const { maximumLayerCountToRender, maximumTextureCountForLayer } = getRenderSupportedLayerCount(
    specs,
    textureInformationPerLayer,
    hasSegmentation,
  );

  if (import.meta.env.MODE !== "test") {
    console.log("maximumLayerCountToRender", maximumLayerCountToRender);
  }

  return {
    textureInformationPerLayer,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
    maximumTextureCountForLayer,
  };
}

export function getGpuFactorsWithLabels() {
  return [
    ["16", "Ultra"],
    ["12", "Very High"],
    ["6", "High"],
    ["4", "Medium"],
    ["2", "Low"],
    ["1", "Very Low"],
  ];
}

function _getSupportedValueRangeForElementClass(
  elementClass: ElementClass,
): readonly [number, number] {
  // The returned range is inclusive (min and max).
  // The function should not be called for (u)int64, because number is not precise enough.
  // Prefer getSegmentIdRangeForElementClass for (u)int64.
  switch (elementClass) {
    case "int8":
      return [-(2 ** 7), 2 ** 7 - 1];
    case "uint8":
    case "uint24":
      // Since uint24 layers are multi-channel, their intensity ranges are equal to uint8
      return [0, 2 ** 8 - 1];

    case "uint16":
      return [0, 2 ** 16 - 1];

    case "uint32":
      return [0, 2 ** 32 - 1];

    case "int16":
      return [-(2 ** 15), 2 ** 15 - 1];

    case "int32":
      return [-(2 ** 31), 2 ** 31 - 1];

    case "float": {
      // Note that the IEEE-754 states the following max value for single-precision floating-point: 3.40282347e38
      // However, highp floats in textures only go until 2^127 (see https://webglreport.com/ for example).
      const maxFloatValue = 2 ** 127;
      return [-maxFloatValue, maxFloatValue];
    }

    // The following dtype(s) are not fully supported.

    case "double": {
      // biome-ignore lint/correctness/noPrecisionLoss: This number literal will lose precision at runtime. The value at runtime will be inf.
      const maxDoubleValue = 1.79769313486232e308;
      return [-maxDoubleValue, maxDoubleValue];
    }

    case "uint64":
      // Note that these high values can only be correctly stored in bigint (and not number).
      // Prefer getSegmentIdRangeForElementClass for (u)int64.
      return [0, 2 ** 64 - 1];
    case "int64":
      return [-(2 ** 64 - 1), 2 ** 64 - 1];
    default:
      throw new Error("Unknown elementClass: " + elementClass);
  }
}

// Use memoization to ensure that the returned tuples always have the
// same identity.
export const getSupportedValueRangeForElementClass = memoize(
  _getSupportedValueRangeForElementClass,
);

function _getSegmentIdRangeForElementClass(elementClass: ElementClass): readonly [bigint, bigint] {
  // The valid (inclusive) range of segment ids for a segmentation layer of the given element
  // class. In contrast to getSupportedValueRangeForElementClass (which is JS-number-based and
  // used for intensity/color ranges), this returns bigint bounds so that uint64/int64 segment
  // ids beyond Number.MAX_SAFE_INTEGER are represented exactly (no 2**53 cap).
  switch (elementClass) {
    case "uint64":
      return [0n, 2n ** 64n - 1n];
    case "int64":
      // Segment ids are non-negative; int64 segmentations use the positive half of the range.
      return [0n, 2n ** 63n - 1n];
    case "float":
    case "double":
      // Floating-point layers are never segmentation layers, so they have no segment-id range.
      throw new Error(`elementClass ${elementClass} has no segment id range`);
    default: {
      const [min, max] = getSupportedValueRangeForElementClass(elementClass);
      return [BigInt(min), BigInt(max)];
    }
  }
}

// Use memoization to ensure that the returned tuples always have the same identity.
export const getSegmentIdRangeForElementClass = memoize(_getSegmentIdRangeForElementClass);

export function getDtypeConfigForElementClass(elementClass: ElementClass): {
  textureType: TextureDataType;
  TypedArrayClass: TypedArrayConstructor;
  pixelFormat: PixelFormat;
  internalFormat: PixelFormatGPU | undefined;
  glslPrefix: "" | "u" | "i";
  isSigned: boolean;
  packingDegree: number;
} {
  // This function needs to be adapted when a new dtype should/element class needs
  // to be supported.

  switch (elementClass) {
    case "int8":
      return {
        textureType: ByteType,
        TypedArrayClass: Int8Array,
        pixelFormat: RGBAFormat,
        internalFormat: "RGBA8_SNORM",
        glslPrefix: "",
        isSigned: true,
        packingDegree: 4,
      };
    case "uint8":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
        packingDegree: 4,
      };
    case "uint24":
      // Since uint24 layers are multi-channel, their intensity ranges are equal to uint8
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
        packingDegree: 1,
      };

    case "uint16":
      return {
        textureType: UnsignedShortType,
        TypedArrayClass: Uint16Array,
        pixelFormat: RGIntegerFormat,
        internalFormat: "RG16UI",
        glslPrefix: "u",
        isSigned: false,
        packingDegree: 2,
      };

    case "int16":
      return {
        textureType: ShortType,
        TypedArrayClass: Int16Array,
        pixelFormat: RGIntegerFormat,
        internalFormat: "RG16I",
        glslPrefix: "i",
        isSigned: true,
        packingDegree: 2,
      };

    case "uint32":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
        packingDegree: 1,
      };

    case "int32":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
        packingDegree: 1,
      };

    case "uint64":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
        packingDegree: 0.5,
      };

    case "int64":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
        packingDegree: 0.5,
      };

    case "float":
      return {
        textureType: FloatType,
        TypedArrayClass: Float32Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
        packingDegree: 4,
      };

    // We do not fully support double
    case "double":
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
        packingDegree: 0.5,
      };

    default:
      return {
        textureType: UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
        packingDegree: 1,
      };
  }
}
