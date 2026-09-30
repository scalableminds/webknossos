import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { document } from "libs/window";
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
import type { ElementClass } from "types/api_types";
import constants from "viewer/constants";
import type { TypedArrayConstructor } from "../helpers/typed_buffer";

type GpuSpecs = {
  supportedTextureSize: number;
  maxTextureCount: number;
};
const lookupTextureCount = 1;
export function getSupportedTextureSpecs(): GpuSpecs {
  const canvas = document.createElement("canvas");
  const contextProvider =
    "getContext" in canvas
      ? (ctxName: "webgl2") => canvas.getContext(ctxName)
      : (ctxName: string) => ({
          MAX_TEXTURE_SIZE: 0,
          MAX_TEXTURE_IMAGE_UNITS: 1,

          getParameter(param: number) {
            if (ctxName === "webgl2") {
              const dummyValues: Record<string, any> = {
                "0": 4096,
                "1": 16,
                "4": "debugInfo.UNMASKED_RENDERER_WEBGL",
                "7937": "Radeon R9 200 Series",
              };
              return dummyValues[param];
            }

            throw new Error(`Unknown call to getParameter: ${param}`);
          },

          getExtension(param: string) {
            if (param === "WEBGL_debug_renderer_info") {
              return {
                UNMASKED_RENDERER_WEBGL: 4,
              };
            }

            throw new Error(`Unknown call to getExtension: ${param}`);
          },
        });
  const gl = contextProvider("webgl2");

  if (!gl) {
    Toast.error(
      <span>
        Your browser does not seem to support WebGL 2. Please upgrade your browser or hardware and
        ensure that WebGL 2 is supported. You might want to use{" "}
        <a href="https://get.webgl.org/webgl2/" target="_blank" rel="noreferrer">
          this site
        </a>{" "}
        to check the WebGL support yourself.
      </span>,
      {
        sticky: true,
      },
    );
    throw new Error("WebGL2 context could not be constructed.");
  }

  const supportedTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxTextureImageUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);

  if (import.meta.env.MODE !== "test") {
    console.log("maxTextureImageUnits", maxTextureImageUnits);
  }

  return {
    supportedTextureSize,
    maxTextureCount: guardAgainstMesaLimit(maxTextureImageUnits, gl),
  };
}

function guardAgainstMesaLimit(maxSamplers: number, gl: any) {
  // Adapted from here: https://github.com/pixijs/pixi.js/pull/6354/files

  try {
    let renderer = gl.getParameter(gl.RENDERER);
    if (renderer == null) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

      if (debugInfo != null) {
        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }
    }

    // Mesa drivers may crash with more than 16 samplers and Firefox
    // will actively refuse to create shaders with more than 16 samplers.
    if (renderer && renderer.slice(0, 4).toUpperCase() === "MESA") {
      maxSamplers = Math.min(16, maxSamplers);
    }
  } catch (exception) {
    ErrorHandling.notify(exception as Error, {}, "warning");
  }

  return maxSamplers;
}

export function validateMinimumRequirements(specs: GpuSpecs): void {
  if (specs.supportedTextureSize < 4096 || specs.maxTextureCount < 8) {
    const msg =
      "Your GPU is not able to render datasets in WEBKNOSSOS. The graphic card should support at least a texture size of 4096 and 8 textures.";
    Toast.error(msg, {
      sticky: true,
    });
    throw new Error(msg);
  }
}
export type DataTextureSizeAndCount = {
  textureSize: number;
  textureCount: number;
  packingDegree: number;
};

export function getBucketCapacity(
  dataTextureCount: number,
  textureWidth: number,
  packingDegree: number,
): number {
  const theoreticalBucketCapacity =
    (packingDegree * dataTextureCount * textureWidth ** 2) / constants.BUCKET_SIZE;
  // RAM-wise we already impose a limit of how many buckets should be held. This limit
  // should not be exceeded.
  return Math.min(constants.MAXIMUM_BUCKET_COUNT_PER_LAYER, theoreticalBucketCapacity);
}

function getNecessaryVoxelCount(requiredBucketCapacity: number) {
  return requiredBucketCapacity * constants.BUCKET_SIZE;
}

function getAvailableVoxelCount(textureSize: number, packingDegree: number) {
  return packingDegree * textureSize ** 2;
}

function getDataTextureCount(
  textureSize: number,
  packingDegree: number,
  requiredBucketCapacity: number,
) {
  return Math.ceil(
    getNecessaryVoxelCount(requiredBucketCapacity) /
      getAvailableVoxelCount(textureSize, packingDegree),
  );
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

// Width and height of every pool texture. Only the depth differs between
// pools (see computeLayerPoolAssignments).
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

// Number of pool slices a layer needs for requiredBucketCapacity buckets.
export function getDataTextureCountForFixedWidth(
  packingDegree: number,
  requiredBucketCapacity: number,
): number {
  return getDataTextureCount(LAYER_POOL_TEXTURE_WIDTH, packingDegree, requiredBucketCapacity);
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

export type LayerPoolAssignment = {
  pool: LayerPool;
  baseSlice: number;
  dataTextureCount: number;
  packingDegree: number;
};

// Assigns every layer (color and segmentation) to its pool and reserves the
// slices [baseSlice, baseSlice + dataTextureCount) of that pool for it. Also
// returns each pool's total depth, which must be known up front, because
// texStorage3D allocates storage that can't grow later.
export function computeLayerPoolAssignments<
  Layer extends { name: string; elementClass: ElementClass },
>(
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
    const dataTextureCount = getDataTextureCountForFixedWidth(
      packingDegree,
      requiredBucketCapacity,
    );
    const baseSlice = poolDepths[pool];
    poolDepths[pool] += dataTextureCount;
    assignmentByLayerName.set(layer.name, { pool, baseSlice, dataTextureCount, packingDegree });
  }

  return { assignmentByLayerName, poolDepths };
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

// Only exported for testing
export function calculateTextureSizeAndCountForLayer(
  specs: GpuSpecs,
  elementClass: ElementClass,
  requiredBucketCapacity: number,
): DataTextureSizeAndCount {
  let textureSize = specs.supportedTextureSize;
  const { packingDegree } = getDtypeConfigForElementClass(elementClass);

  // Try to half the texture size as long as it does not require more
  // data textures. This ensures that we maximize the number of simultaneously
  // renderable layers.
  while (
    getDataTextureCount(textureSize / 2, packingDegree, requiredBucketCapacity) <=
    getDataTextureCount(textureSize, packingDegree, requiredBucketCapacity)
  ) {
    textureSize /= 2;
  }

  const textureCount = getDataTextureCount(textureSize, packingDegree, requiredBucketCapacity);
  return {
    textureSize,
    textureCount,
    packingDegree,
  };
}

function buildTextureInformationMap<
  Layer extends {
    elementClass: ElementClass;
    category: "color" | "segmentation";
  },
>(
  layers: Array<Layer>,
  specs: GpuSpecs,
  requiredBucketCapacity: number,
): Map<Layer, DataTextureSizeAndCount> {
  const textureInformationPerLayer = new Map();
  layers.forEach((layer) => {
    const sizeAndCount = calculateTextureSizeAndCountForLayer(
      specs,
      layer.elementClass,
      requiredBucketCapacity,
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

  // Without any GPU restrictions, WK would be able to render all color layers
  // plus one segmentation layer. Use that as the upper layer count limit to avoid
  // compiling too complex shaders.
  const maximumLayerCount =
    Array.from(textureInformationPerLayer.keys()).filter((l) => l.category === "color").length +
    (hasSegmentation ? 1 : 0);
  return {
    maximumLayerCountToRender: Math.min(maximumLayerCountToRender, maximumLayerCount),
    maximumTextureCountForLayer,
  };
}

export function computeDataTexturesSetup<
  Layer extends {
    elementClass: ElementClass;
    category: "color" | "segmentation";
  },
>(specs: GpuSpecs, layers: Array<Layer>, hasSegmentation: boolean, requiredBucketCapacity: number) {
  const textureInformationPerLayer = buildTextureInformationMap(
    layers,
    specs,
    requiredBucketCapacity,
  );
  const smallestCommonBucketCapacity = getSmallestCommonBucketCapacity(textureInformationPerLayer);
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
