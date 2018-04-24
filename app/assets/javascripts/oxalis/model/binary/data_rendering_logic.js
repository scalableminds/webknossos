// @flow
import constants from "oxalis/constants";

type GpuSpecs = {
  supportedTextureSize: number,
  maxTextureCount: number,
};

export function getSupportedTextureMetrics(): GpuSpecs {
  const canvas = document.createElement("canvas");
  const contextProvider = canvas.getContext
    ? x => canvas.getContext(x)
    : ctxName => ({
        MAX_TEXTURE_SIZE: 0,
        MAX_COMBINED_TEXTURE_IMAGE_UNITS: 1,
        getParameter(param) {
          return ctxName === "webgl" && param === 0 ? 4096 : 8192;
        },
      });

  const gl = contextProvider("webgl");

  if (!gl) {
    throw new Error("WebGL context could not be constructed.");
  }

  const supportedTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxTextureCount = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);

  return { supportedTextureSize, maxTextureCount };
}

export function validateMinimumRequirements(specs: GpuSpecs): void {
  if (specs.supportedTextureSize < 4096 || specs.maxTextureCount < 8) {
    throw new Error(
      "Minimum spec is not met. GPU should support at least a texture size of 4096 and 8 textures.",
    );
  }
}

export type DataTextureSizeAndCount = { textureSize: number, textureCount: number };

function getPackingDegree(byteCount: number) {
  // If the layer only holds one byte per voxel, we can pack 4 bytes using rgba channels
  return byteCount === 1 ? 4 : 1;
}

function getNecessaryVoxelCount() {
  const bucketCountPerPlane =
    constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION ** 2 + // buckets in current zoomStep
    Math.ceil(constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION / 2) ** 2; // buckets in fallback zoomstep;
  return 3 * bucketCountPerPlane * constants.BUCKET_SIZE;
}

function getAvailableVoxelCount(textureSize: number, packingDegree: number) {
  return packingDegree * textureSize ** 2;
}

function getTextureCount(textureSize: number, packingDegree: number) {
  return Math.ceil(getNecessaryVoxelCount() / getAvailableVoxelCount(textureSize, packingDegree));
}

export function calculateTextureSizeAndCountForLayer(
  specs: GpuSpecs,
  byteCount: number,
): DataTextureSizeAndCount {
  let textureSize = specs.supportedTextureSize; // >= 8192 ? 8192 : 4096;
  const packingDegree = getPackingDegree(byteCount);

  // Try to half the texture size as long as it does not require more
  // data textures
  while (
    getTextureCount(textureSize / 2, packingDegree) <= getTextureCount(textureSize, packingDegree)
  ) {
    textureSize /= 2;
  }

  const textureCount = getTextureCount(textureSize, packingDegree);
  return { textureSize, textureCount };
}
