import "test/mocks/lz4";
import getMainFragmentShader from "oxalis/shaders/main_data_shaders.glsl";
import mags from "test/fixtures/mags";
import test, { type ExecutionContext } from "ava";
import { parser } from "@shaderfrog/glsl-parser";

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
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: [],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    tpsTransformPerLayer: {},
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

test("Shader syntax: Ortho Mode + Segmentation - Mapping", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["segmentationLayer"]: { packingDegree: 1.0, dataTextureCount: 4 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: ["segmentationLayer"],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    tpsTransformPerLayer: {},
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Ortho Mode + Segmentation + Mapping", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["segmentationLayer"]: { packingDegree: 1.0, dataTextureCount: 4 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: ["segmentationLayer"],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    tpsTransformPerLayer: {},
  });

  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Arbitrary Mode (no segmentation available)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: [],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: false,
    tpsTransformPerLayer: {},
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Arbitrary Mode (segmentation available)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
      ["segmentationLayer"]: { packingDegree: 1.0, dataTextureCount: 4 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: ["segmentationLayer"],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: false,
    tpsTransformPerLayer: {},
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});

test("Shader syntax: Ortho Mode (rgb and float layer)", (t: ExecutionContext<any>) => {
  const code = getMainFragmentShader({
    globalLayerCount: 2,
    colorLayerNames: ["color_layer_1", "color_layer_2"],
    textureLayerInfos: {
      ["color_layer_1"]: { packingDegree: 1.0, dataTextureCount: 1 },
      ["color_layer_2"]: { packingDegree: 4.0, dataTextureCount: 1 },
    },
    orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
    segmentationLayerNames: [],
    magnificationsCount: mags.length,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    tpsTransformPerLayer: {},
  });
  parser.parse(code);
  t.true(t.context.warningEmittedCount === 0);
});
