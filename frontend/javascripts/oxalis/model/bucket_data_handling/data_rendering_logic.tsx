import React from "react";
import _ from "lodash";
import { document } from "libs/window";
import type { Vector3 } from "oxalis/constants";
import constants from "oxalis/constants";
import type { ElementClass } from "types/api_flow_types";
import Toast from "libs/toast";
type GpuSpecs = {
  supportedTextureSize: number;
  maxTextureCount: number;
};
const lookupTextureCountPerLayer = 1;
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

  if (process.env.BABEL_ENV !== "test") {
    console.log("maxTextureImageUnits", maxTextureImageUnits);
  }

  return {
    supportedTextureSize,
    maxTextureCount: guardAgainstMesaLimit(maxTextureImageUnits, gl),
  };
}

function guardAgainstMesaLimit(maxSamplers: number, gl: any) {
  // Adapted from here: https://github.com/pixijs/pixi.js/pull/6354/files
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

  // Mesa drivers may crash with more than 16 samplers and Firefox
  // will actively refuse to create shaders with more than 16 samplers.
  if (renderer.slice(0, 4).toUpperCase() === "MESA") {
    maxSamplers = Math.min(16, maxSamplers);
  }

  return maxSamplers;
}

export function validateMinimumRequirements(specs: GpuSpecs): void {
  if (specs.supportedTextureSize < 4096 || specs.maxTextureCount < 8) {
    const msg =
      "Your GPU is not able to render datasets in webKnossos. The graphic card should support at least a texture size of 4096 and 8 textures.";
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

export function calculateTextureSizeAndCountForLayer(
  specs: GpuSpecs,
  byteCount: number,
  elementClass: ElementClass,
  requiredBucketCapacity: number,
): DataTextureSizeAndCount {
  let textureSize = specs.supportedTextureSize;
  const packingDegree = getPackingDegree(byteCount, elementClass);

  // Try to half the texture size as long as it does not require more
  // data textures
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
    (specs.maxTextureCount - textureCountForSegmentation) /
      (lookupTextureCountPerLayer + maximumTextureCountForLayer),
  );
  return {
    maximumLayerCountToRender,
    maximumTextureCountForLayer,
  };
}

export function computeDataTexturesSetup<
  Layer extends {
    elementClass: ElementClass;
  },
>(
  specs: GpuSpecs,
  layers: Array<Layer>,
  getByteCountForLayer: (arg0: Layer) => number,
  hasSegmentation: boolean,
  requiredBucketCapacity: number,
): any {
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

  if (process.env.BABEL_ENV !== "test") {
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
    ["12", "Very High"],
    ["6", "High"],
    ["3", "Medium"],
    ["1", "Low"],
  ];
}
export function getLookupBufferSize(gpuMultiplier: number): number {
  switch (gpuMultiplier) {
    case 1:
    case 3:
      return 256;

    case 6:
      return 512;

    case 12:
      return 1024;

    default:
      return 512;
  }
}
// A look up buffer with the size [key]**2 is able to represent
// a volume with the dimensions of [value].
// The values were chosen so that value[0]*value[1]*value[2] / key**2
// approaches ~ 1 (i.e., the utilization ratio of the buffer is close to
// 100%).
const addressSpaceDimensionsTable: Record<string, Vector3> = {
  "256": [36, 36, 50],
  "512": [61, 61, 70],
  "1024": [96, 96, 112],
};
export function getAddressSpaceDimensions(gpuMultiplier: number): Vector3 {
  const lookupBufferSize = getLookupBufferSize(gpuMultiplier);
  return addressSpaceDimensionsTable[lookupBufferSize] || addressSpaceDimensionsTable["256"];
}
