// @flow
import glslParser from "glsl-parser";

import { getLookupBufferSize } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import constants from "oxalis/constants";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import resolutions from "test/fixtures/resolutions";
import test from "ava";

const DEFAULT_LOOK_UP_TEXTURE_WIDTH = getLookupBufferSize(constants.DEFAULT_GPU_MEMORY_FACTOR);

test("Shader syntax: Ortho Mode", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 4.0, color_layer_2: 4.0 },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode + Segmentation - Mapping", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 4.0, color_layer_2: 4.0, segmentationLayer: 1.0 },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: false,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode + Segmentation + Mapping", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 4.0, color_layer_2: 4.0, segmentationLayer: 1.0 },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Arbitrary Mode (no segmentation available)", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 4.0, color_layer_2: 4.0 },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Arbitrary Mode (segmentation available)", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 4.0, color_layer_2: 4.0, segmentationLayer: 1.0 },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode (rgb and float layer)", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: { color_layer_1: 1.0, color_layer_2: 4.0 },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});
