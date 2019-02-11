// @flow
import glslParser from "glsl-parser";

import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import resolutions from "test/fixtures/resolutions";
import test from "ava";

test("Shader syntax: Ortho Mode", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    isRgbLayerLookup: { color_layer_1: false, color_layer_2: false },
    hasSegmentation: false,
    segmentationName: "",
    segmentationPackingDegree: 1,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode + Segmentation - Mapping", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    isRgbLayerLookup: { color_layer_1: false, color_layer_2: false },
    hasSegmentation: true,
    segmentationName: "segmentationLayer",
    segmentationPackingDegree: 1,
    isMappingSupported: false,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode + Segmentation + Mapping", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    isRgbLayerLookup: { color_layer_1: false, color_layer_2: false },
    hasSegmentation: true,
    segmentationName: "segmentationLayer",
    segmentationPackingDegree: 1,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Arbitrary Mode (no segmentation available)", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    isRgbLayerLookup: { color_layer_1: false, color_layer_2: false },
    hasSegmentation: false,
    segmentationName: "",
    segmentationPackingDegree: 1,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Arbitrary Mode (segmentation available)", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    isRgbLayerLookup: { color_layer_1: false, color_layer_2: false },
    hasSegmentation: true,
    segmentationName: "segmentationLayer",
    segmentationPackingDegree: 1,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});
