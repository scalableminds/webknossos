import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { document } from "libs/window";
import _ from "lodash";
import constants from "oxalis/constants";
import * as THREE from "three";
import type { ElementClass } from "types/api_flow_types";
import type { TypedArrayConstructor } from "./bucket";

type GpuSpecs = {
  supportedTextureSize: number;
  maxTextureCount: number;
};
const lookupTextureCount = 1;
export function getSupportedTextureSpecs(): GpuSpecs {
  // @ts-ignore
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

  if (!process.env.IS_TESTING) {
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
export function getPackingDegree(byteCount: number, elementClass: ElementClass) {
  // How many voxels does one texel represent? E.g.,
  // For uint8 layers, one texel stores 4 voxels => packingDegree == 4
  // For uint16 layers, one texel stores 2 voxels => packignDegree == 2.
  //
  // If the layer holds less than 4 byte per voxel, we can pack multiple voxels using rgba channels
  // Float textures can hold a float per channel, adjust the packing degree accordingly
  // 64-bit values need two texel per data voxel which is why their packing degree is lower than 1.

  if (byteCount === 1 || elementClass === "float") return 4;
  if (byteCount === 2) return 2;
  if (byteCount === 8) return 0.5;
  return 1;
}
export function getChannelCount(
  byteCount: number,
  packingDegree: number,
  elementClass: ElementClass,
) {
  if (elementClass === "float") {
    // Float textures can hold a float per channel, so divide bytes by 4
    return (byteCount / 4) * packingDegree;
  } else {
    return byteCount * packingDegree;
  }
}
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

// Only exported for testing
export function calculateTextureSizeAndCountForLayer(
  specs: GpuSpecs,
  byteCount: number,
  elementClass: ElementClass,
  requiredBucketCapacity: number,
): DataTextureSizeAndCount {
  let textureSize = specs.supportedTextureSize;
  const packingDegree = getPackingDegree(byteCount, elementClass);

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
  getByteCountForLayer: (arg0: Layer) => number,
  specs: GpuSpecs,
  requiredBucketCapacity: number,
): Map<Layer, DataTextureSizeAndCount> {
  const textureInformationPerLayer = new Map();
  layers.forEach((layer) => {
    const sizeAndCount = calculateTextureSizeAndCountForLayer(
      specs,
      getByteCountForLayer(layer),
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
  return _.min(capacities) || 0;
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
    _.max(
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
>(
  specs: GpuSpecs,
  layers: Array<Layer>,
  getByteCountForLayer: (arg0: Layer) => number,
  hasSegmentation: boolean,
  requiredBucketCapacity: number,
) {
  const textureInformationPerLayer = buildTextureInformationMap(
    layers,
    getByteCountForLayer,
    specs,
    requiredBucketCapacity,
  );
  const smallestCommonBucketCapacity = getSmallestCommonBucketCapacity(textureInformationPerLayer);
  const { maximumLayerCountToRender, maximumTextureCountForLayer } = getRenderSupportedLayerCount(
    specs,
    textureInformationPerLayer,
    hasSegmentation,
  );

  if (!process.env.IS_TESTING) {
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

export function getSupportedValueRangeForElementClass(
  elementClass: ElementClass,
): [number, number] {
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

    // todop: adapt for new dtypes
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

    // The following dtypes are not fully supported.

    case "double": {
      // biome-ignore lint/correctness/noPrecisionLoss: This number literal will lose precision at runtime. The value at runtime will be inf.
      const maxDoubleValue = 1.79769313486232e308;
      return [-maxDoubleValue, maxDoubleValue];
    }

    // Int64 types are only supported for segmentations (which don't need to call this
    // function as there will be no histogram). Still, for the record: 2 ** 53 - 1
    // is currently the maximum supported "64-bit" segment id due to JS Number.
    case "uint64":
    case "int64":
    default:
      return [0, 255];
  }
}

export function getDtypeConfigForElementClass(elementClass: ElementClass): {
  textureType: THREE.TextureDataType;
  TypedArrayClass: TypedArrayConstructor;
  pixelFormat: THREE.PixelFormat | undefined;
  internalFormat: THREE.PixelFormatGPU | undefined;
  glslPrefix: "" | "u" | "i";
  isSigned: boolean;
} {
  // todop: adapt for new dtypes

  switch (elementClass) {
    case "int8":
      return {
        textureType: THREE.ByteType,
        TypedArrayClass: Int8Array,
        pixelFormat: undefined,
        internalFormat: "RGBA8_SNORM",
        glslPrefix: "",
        isSigned: true,
      };
    case "uint8":
    case "uint24":
      // Since uint24 layers are multi-channel, their intensity ranges are equal to uint8
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
      };

    case "uint16":
      return {
        textureType: THREE.UnsignedShortType,
        TypedArrayClass: Uint16Array,
        pixelFormat: THREE.RGIntegerFormat,
        internalFormat: "RG16UI",
        glslPrefix: "u",
        isSigned: false,
      };

    case "int16":
      return {
        textureType: THREE.ShortType,
        TypedArrayClass: Int16Array,
        pixelFormat: THREE.RGIntegerFormat,
        internalFormat: "RG16I",
        glslPrefix: "i",
        isSigned: true,
      };

    case "uint32":
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
      };

    case "int32":
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
      };

    case "uint64":
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
      };

    case "int64":
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
      };

    case "float":
      return {
        textureType: THREE.FloatType,
        TypedArrayClass: Float32Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
      };

    // We do not fully support all signed int data
    case "double":
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: true,
      };

    default:
      return {
        textureType: THREE.UnsignedByteType,
        TypedArrayClass: Uint8Array,
        pixelFormat: undefined,
        internalFormat: undefined,
        glslPrefix: "",
        isSigned: false,
      };
  }
}
