import { getLookupBufferSize } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import constants from "oxalis/constants";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import resolutions from "test/fixtures/resolutions";
import test, { ExecutionContext } from "ava";
import { parser } from "@shaderfrog/glsl-parser";

const DEFAULT_LOOK_UP_TEXTURE_WIDTH = getLookupBufferSize(constants.DEFAULT_GPU_MEMORY_FACTOR);

test.beforeEach((t: ExecutionContext<any>) => {
  t.context.originalWarn = console.warn;
  t.context.warningEmittedCount = 0;
  console.warn = (...args) => {
    t.context.warningEmittedCount++;
    t.context.originalWarn(...args);
  };
});

test.afterEach(async (t: ExecutionContext<any>) => {
  console.warn = t.context.originalWarn;
});

test("Shader syntax: Ortho Mode", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 4.0,
      color_layer_2: 4.0,
    },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  /*
   * If the code contains a syntax error, parse() will throw an exception
   * which makes the test fail.
   * If a warning was emitted during parsing, the `warningEmittedCount`
   * will reflect this.
   */
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test.skip("Shader syntax: Ortho Mode + Segmentation - Mapping", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 4.0,
      color_layer_2: 4.0,
      segmentationLayer: 1.0,
    },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: false,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test.skip("Shader syntax: Ortho Mode + Segmentation + Mapping", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 4.0,
      color_layer_2: 4.0,
      segmentationLayer: 1.0,
    },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });

  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Arbitrary Mode (no segmentation available)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 4.0,
      color_layer_2: 4.0,
    },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test.skip("Shader syntax: Arbitrary Mode (segmentation available)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 4.0,
      color_layer_2: 4.0,
      segmentationLayer: 1.0,
    },
    segmentationLayerNames: ["segmentationLayer"],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: false,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Ortho Mode (rgb and float layer)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    packingDegreeLookup: {
      color_layer_1: 1.0,
      color_layer_2: 4.0,
    },
    segmentationLayerNames: [],
    isMappingSupported: true,
    dataTextureCountPerLayer: 3,
    resolutions,
    datasetScale: [1, 1, 1],
    isOrthogonal: true,
    lookupTextureWidth: DEFAULT_LOOK_UP_TEXTURE_WIDTH,
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});
