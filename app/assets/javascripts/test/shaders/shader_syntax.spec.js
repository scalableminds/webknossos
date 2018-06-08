// @flow
import test from "ava";
import glslParser from "glsl-parser";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import resolutions from "test/fixtures/resolutions";
import { OrthoViews } from "oxalis/constants";

test("Shader syntax: Ortho Mode", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    hasSegmentation: false,
    segmentationName: "",
    segmentationPackingDegree: 1,
    isRgb: false,
    planeID: OrthoViews.PLANE_XY,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});

test("Shader syntax: Ortho Mode + Segmentation", t => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    hasSegmentation: true,
    segmentationName: "segmentationLayer",
    segmentationPackingDegree: 1,
    isRgb: false,
    planeID: OrthoViews.PLANE_XY,
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
  });

  const parseResult = glslParser.check(code);

  t.is(parseResult.log.warningCount, 0);
  t.is(parseResult.log.errorCount, 0);
});
