// @flow
import _ from "lodash";

import { document } from "libs/window";
import constants from "oxalis/constants";

type GpuSpecs = {
  supportedTextureSize: number,
  maxTextureCount: number,
};

export function getSupportedTextureSpecs(): GpuSpecs {
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

export function getPackingDegree(byteCount: number) {
  // If the layer only holds one byte per voxel, we can pack 4 bytes using rgba channels
  return byteCount === 1 ? 4 : 1;
}

function getNecessaryVoxelCount() {
  return constants.MINIMUM_REQUIRED_BUCKET_CAPACITY * constants.BUCKET_SIZE;
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
  let textureSize = specs.supportedTextureSize;
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

function buildTextureInformationMap<Layer>(
  layers: Array<Layer>,
  getByteCountForLayer: Layer => number,
  specs: GpuSpecs,
): Map<Layer, DataTextureSizeAndCount> {
  const textureInformationPerLayer = new Map();

  layers.forEach(layer => {
    const sizeAndCount = calculateTextureSizeAndCountForLayer(specs, getByteCountForLayer(layer));
    textureInformationPerLayer.set(layer, sizeAndCount);
  });

  return textureInformationPerLayer;
}

function calculateNecessaryTextureCount<Layer>(
  textureInformationPerLayer: Map<Layer, DataTextureSizeAndCount>,
): number {
  const layers = Array.from(textureInformationPerLayer.values());
  const totalDataTextureCount = _.sum(layers.map(info => info.textureCount));

  const lookupTextureCountPerLayer = 1;
  const necessaryTextureCount = layers.length * lookupTextureCountPerLayer + totalDataTextureCount;

  return necessaryTextureCount;
}

function calculateMappingTextureCount(): number {
  // If there is a segmentation layer, we need one lookup, one data and one color texture for mappings
  const textureCountForCellMappings = 3;
  return textureCountForCellMappings;
}

function deriveSupportedFeatures<Layer>(
  specs: GpuSpecs,
  textureInformationPerLayer: Map<Layer, DataTextureSizeAndCount>,
  hasSegmentation: boolean,
): * {
  const necessaryTextureCount = calculateNecessaryTextureCount(textureInformationPerLayer);

  let isMappingSupported = true;
  let isBasicRenderingSupported = true;

  if (necessaryTextureCount > specs.maxTextureCount) {
    isBasicRenderingSupported = false;
  }

  // Count textures needed for mappings separately, because they are not strictly necessary
  const notEnoughTexturesForMapping =
    necessaryTextureCount + calculateMappingTextureCount() > specs.maxTextureCount;
  if (hasSegmentation && notEnoughTexturesForMapping) {
    // Only mark mappings as unsupported if a segmentation exists
    isMappingSupported = false;
  }

  return {
    isMappingSupported,
    isBasicRenderingSupported,
  };
}

export function computeDataTexturesSetup<Layer>(
  specs: GpuSpecs,
  layers: Array<Layer>,
  getByteCountForLayer: Layer => number,
  hasSegmentation: boolean,
): * {
  const textureInformationPerLayer = buildTextureInformationMap(
    layers,
    getByteCountForLayer,
    specs,
  );

  const { isBasicRenderingSupported, isMappingSupported } = deriveSupportedFeatures(
    specs,
    textureInformationPerLayer,
    hasSegmentation,
  );

  return {
    isBasicRenderingSupported,
    isMappingSupported,
    textureInformationPerLayer,
  };
}
