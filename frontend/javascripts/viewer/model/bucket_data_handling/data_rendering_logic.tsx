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
import type { AdditionalAxis, ElementClass } from "types/api_types";
import constants, { getEffectiveBucketDepth, wantsTRecycling } from "viewer/constants";
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
  // The number of voxels a single bucket occupies in this layer's atlas. Equal to
  // constants.BUCKET_SIZE, unless the layer has a degenerate (e.g., z-extent-1) axis,
  // in which case buckets are packed with a smaller footprint. See getEffectiveBucketDepth.
  bucketVoxelCount: number;
};

// A data texture is a flat 2D atlas in which each bucket occupies a whole number of
// texture rows (a row cannot be shared by two buckets). For most (non-degenerate)
// layers, a bucket's packed data is larger than one texture row, so this height is
// simply the natural (possibly multi-row) value. For layers with a much smaller
// bucket footprint (e.g., 2D datasets), a bucket may pack into less than one row;
// the height is then rounded up to one full row, at the cost of some unused padding.
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

// Note that this has to go through getBucketsPerTexture rather than dividing the
// required voxels by the texture's voxel area: a bucket occupies a whole number of
// texture rows, so for layers whose packed bucket is smaller than one row (see
// getBucketHeightInTexture) part of that row is padding that cannot hold another
// bucket. Sizing by raw area would count that padding as usable and pick a texture
// too small to actually hold requiredBucketCapacity buckets — which getBucketCapacity,
// computing the same thing row-aware, would then report as a shortfall.
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
    // A layer that will use t-recycling (see TextureBucketManager) needs its atlas
    // sized for full-depth buckets, not the shrunk depth, even though it's
    // z-degenerate. Both decisions must stay in sync, hence the shared helper.
    // Volume tracing layers are already merged into the dataset's layers (with their
    // tracingId set) by preprocessDataset before this runs, so the editability check
    // here sees the same thing DataCube's constructor later will.
    const bucketVoxelCount = wantsTRecycling(
      layer.boundingBox.depth,
      hasTAxis,
      layer.tracingId != null,
    )
      ? constants.BUCKET_SIZE
      : constants.BUCKET_WIDTH ** 2 * getEffectiveBucketDepth(layer.boundingBox.depth);
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
    boundingBox: { depth: number };
    additionalAxes: Array<AdditionalAxis> | null;
    tracingId?: string;
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
