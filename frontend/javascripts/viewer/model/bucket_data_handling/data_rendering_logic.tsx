import memoize from "lodash-es/memoize";
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
  // Maximum number of slices per texture array, i.e. per pool.
  maxArrayTextureLayers: number;
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

export type LayerLike = {
  elementClass: ElementClass;
  category: "color" | "segmentation";
  boundingBox: { depth: number };
  additionalAxes: Array<AdditionalAxis> | null;
  tracingId?: string;
};

// The number of voxels one bucket of this layer occupies on the GPU. Smaller
// than constants.BUCKET_SIZE for layers with a degenerate depth (see
// getEffectiveBucketDepth).
export function getGpuBucketVoxelCountForLayer(layer: LayerLike): number {
  const hasTAxis = layer.additionalAxes?.some((axis) => axis.name === "t") ?? false;
  // A t-recycling layer needs full-depth slots despite being z-degenerate.
  return usesTRecycling(layer.boundingBox.depth, hasTAxis, layer.tracingId != null)
    ? constants.BUCKET_SIZE
    : constants.BUCKET_SIZE_2D *
        getEffectiveBucketDepth(layer.boundingBox.depth, layer.tracingId != null);
}

// The buckets of all layers that share a GPU texture format are stored in one
// shared sampler2DArray (a "pool"). Each layer owns a range of the pool's
// slices. So there is one texture per pool, no matter how many layers exist.
export enum LayerPool {
  F32 = 0,
  U8 = 1,
  S8 = 2,
  U16 = 3,
  S16 = 4,
}
export const LAYER_POOLS = [
  LayerPool.F32,
  LayerPool.U8,
  LayerPool.S8,
  LayerPool.U16,
  LayerPool.S16,
] as const;

// Width and height of every pool texture; 2048 is the smallest MAX_TEXTURE_SIZE
// that WebGL2 guarantees. Only the depth differs between pools.
export const LAYER_POOL_TEXTURE_WIDTH = 2048;

export function getLayerPoolForElementClass(elementClass: ElementClass): LayerPool {
  switch (elementClass) {
    case "float":
      return LayerPool.F32;
    case "int8":
      return LayerPool.S8;
    case "uint16":
      return LayerPool.U16;
    case "int16":
      return LayerPool.S16;
    // uint8, uint24, uint32, int32, uint64, int64, double: stored as raw RGBA
    // bytes and decoded in the shader (see layerDtypeTag).
    default:
      return LayerPool.U8;
  }
}

export function getLayerPoolGpuConfig(pool: LayerPool): {
  textureType: TextureDataType;
  pixelFormat: PixelFormat;
  internalFormat: PixelFormatGPU | undefined;
} {
  switch (pool) {
    case LayerPool.F32:
      return {
        textureType: FloatType,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
      };
    case LayerPool.U8:
      return {
        textureType: UnsignedByteType,
        pixelFormat: RGBAFormat,
        internalFormat: undefined,
      };
    case LayerPool.S8:
      return {
        textureType: ByteType,
        pixelFormat: RGBAFormat,
        internalFormat: "RGBA8_SNORM",
      };
    case LayerPool.U16:
      return {
        textureType: UnsignedShortType,
        pixelFormat: RGIntegerFormat,
        internalFormat: "RG16UI",
      };
    case LayerPool.S16:
      return {
        textureType: ShortType,
        pixelFormat: RGIntegerFormat,
        internalFormat: "RG16I",
      };
    default:
      throw new Error(`Unknown layer pool: ${pool}`);
  }
}

// Factor that scales a fetched texel to the layer's native value range
// (e.g. 0-255 for uint8, -128..127 for int8, unchanged for float). Baked into
// the shader as layerDtypeNormalizer.
export function getDtypeNormalizerForLayer(textureLayerInfo: {
  isColor: boolean;
  isSigned: boolean;
  elementClass: ElementClass;
}): number {
  const { isColor, isSigned, elementClass } = textureLayerInfo;
  if (isColor && !elementClass.endsWith("int8")) {
    return 1;
  } else if (isSigned && !elementClass.endsWith("int32") && !elementClass.endsWith("int64")) {
    return 127;
  } else {
    return 255;
  }
}

const BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY = 4;
// Keeps layers from getting so few buckets that they constantly reload.
const MINIMUM_BUCKET_CAPACITY_PER_LAYER = 128;

// All layers hold buckets at the same time, so a fixed per-layer budget would
// make memory grow with the layer count (and e.g. 22 layers exhaust GPU
// memory). Instead, the budget of BASELINE_LAYER_COUNT_FOR_BUCKET_CAPACITY
// layers is the total, split evenly when there are more layers than that.
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

// Lookup-table entries store a bucket address in 21 bits; the largest value
// means "not yet committed" (see TextureBucketManager).
const MAX_BUCKET_ADDRESS = 2 ** 21 - 2;

export type LayerPoolAssignment = {
  pool: LayerPool;
  baseSlice: number;
  dataTextureCount: number;
  bucketsPerSlice: number;
};

// Assigns every layer to its pool and reserves the slices
// [baseSlice, baseSlice + dataTextureCount) of that pool for it. Also returns
// each pool's total depth, which must be known up front, because texStorage3D
// allocates storage that can't grow later.
export function computeLayerPoolAssignments<Layer extends LayerLike & { name: string }>(
  layers: Array<Layer>,
  requiredBucketCapacity: number,
): {
  assignmentByLayerName: Map<string, LayerPoolAssignment>;
  poolDepths: Record<LayerPool, number>;
} {
  const poolDepths: Record<LayerPool, number> = {
    [LayerPool.F32]: 0,
    [LayerPool.U8]: 0,
    [LayerPool.S8]: 0,
    [LayerPool.U16]: 0,
    [LayerPool.S16]: 0,
  };
  const assignmentByLayerName = new Map<string, LayerPoolAssignment>();

  for (const layer of layers) {
    const pool = getLayerPoolForElementClass(layer.elementClass);
    const { packingDegree } = getDtypeConfigForElementClass(layer.elementClass);
    const bucketVoxelCount = getGpuBucketVoxelCountForLayer(layer);
    const dataTextureCount = getDataTextureCount(
      LAYER_POOL_TEXTURE_WIDTH,
      packingDegree,
      requiredBucketCapacity,
      bucketVoxelCount,
    );
    const bucketsPerSlice = getBucketsPerTexture(
      LAYER_POOL_TEXTURE_WIDTH,
      packingDegree,
      bucketVoxelCount,
    );
    const baseSlice = poolDepths[pool];
    poolDepths[pool] += dataTextureCount;
    assignmentByLayerName.set(layer.name, { pool, baseSlice, dataTextureCount, bucketsPerSlice });
  }

  return { assignmentByLayerName, poolDepths };
}

// Lowers the per-layer bucket capacity until every pool fits into
// maxPoolDepth slices (the GPU's MAX_ARRAY_TEXTURE_LAYERS) and every bucket
// address fits into the lookup table.
export function computeLayerPoolPlan<Layer extends LayerLike & { name: string }>(
  layers: Array<Layer>,
  requiredBucketCapacity: number,
  maxPoolDepth: number,
): {
  bucketCapacity: number;
  assignmentByLayerName: Map<string, LayerPoolAssignment>;
  poolDepths: Record<LayerPool, number>;
} {
  let bucketCapacity = requiredBucketCapacity;
  let plan = computeLayerPoolAssignments(layers, bucketCapacity);
  const getOverflowRatio = () => {
    const deepestPool = Math.max(...Object.values(plan.poolDepths));
    const largestAddressCount = Math.max(
      0,
      ...Array.from(plan.assignmentByLayerName.values()).map(
        ({ baseSlice, dataTextureCount, bucketsPerSlice }) =>
          (baseSlice + dataTextureCount) * bucketsPerSlice,
      ),
    );
    return Math.max(deepestPool / maxPoolDepth, largestAddressCount / (MAX_BUCKET_ADDRESS + 1));
  };
  let overflowRatio = getOverflowRatio();
  while (overflowRatio > 1 && bucketCapacity > 1) {
    // Slice counts are rounded up, so the proportional estimate may still be
    // too big; the loop then shrinks further.
    const estimate = Math.floor(bucketCapacity / overflowRatio);
    bucketCapacity = Math.max(1, Math.min(bucketCapacity - 1, estimate));
    plan = computeLayerPoolAssignments(layers, bucketCapacity);
    overflowRatio = getOverflowRatio();
  }
  return { bucketCapacity, ...plan };
}

// Which of uint64ToUint64/int32ToUint64/uint32ToUint64 (segmentation.glsl.ts)
// decodes a segmentation layer's fetched bytes. 64-bit ids are decoded the
// same way whether they are signed or not.
export const SEGMENT_ID_DECODE_TAG_64BIT = 0;
export const SEGMENT_ID_DECODE_TAG_SIGNED = 1;
export const SEGMENT_ID_DECODE_TAG_UNSIGNED = 2;

export function getSegmentIdDecodeTagForLayer(
  elementClass: ElementClass,
  isSigned: boolean,
): number {
  if (elementClass.endsWith("int64")) {
    return SEGMENT_ID_DECODE_TAG_64BIT;
  }
  return isSigned ? SEGMENT_ID_DECODE_TAG_SIGNED : SEGMENT_ID_DECODE_TAG_UNSIGNED;
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

// Selects the byte-decoding branch in the shader's color-blending loop.
export const DTYPE_TAG_DEFAULT = 0;
export const DTYPE_TAG_UINT24 = 1;
export const DTYPE_TAG_INT32 = 2;
export const DTYPE_TAG_UINT32 = 3;

export function getDtypeTagForElementClass(elementClass: ElementClass): number {
  if (elementClass === "int32") {
    return DTYPE_TAG_INT32;
  }
  if (elementClass === "uint32") {
    return DTYPE_TAG_UINT32;
  }
  if (elementClass === "uint24") {
    return DTYPE_TAG_UINT24;
  }
  return DTYPE_TAG_DEFAULT;
}

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
