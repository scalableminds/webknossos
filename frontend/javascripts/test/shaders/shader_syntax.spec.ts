import getMainFragmentShader, {
  getMainVertexShader,
  type Params,
} from "viewer/shaders/main_data_shaders.glsl";
import mags from "test/fixtures/mags";
import { describe, it, beforeEach, expect } from "vitest";
import { parser } from "@shaderfrog/glsl-parser";

type ShaderFunction = (params: Params) => string;

describe("Shader syntax", () => {
  const originalWarn = console.warn;

  interface TestContext {
    warnings: { emittedCount: number };
  }

  beforeEach<TestContext>(async ({ warnings }) => {
    console.warn = (...args: any[]) => {
      warnings.emittedCount++;
      originalWarn(...args);
    };
    warnings.emittedCount = 0;
  });

  // Extend the context by creating a new test function, because the extra context type cannot be supplied
  // to it otherwise
  const shaderTest = it.extend({
    warnings: { emittedCount: 0 },
  });

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Ortho Mode %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        voxelSizeFactorInverted: [1, 1, 1],
        useInterpolation: false,
        tpsTransformPerLayer: {},
        isWindows: false,
      });

      /*
       * If the code contains a syntax error, parse() will throw an exception
       * which makes the test fail.
       * If a warning was emitted during parsing, the `warnings.emittedCount`
       * will reflect this.
       */
      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Ortho Mode + Segmentation - Mapping %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: true,
            packingDegree: 1.0,
            dataTextureCount: 4,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "segmentationLayer",
            elementClass: "uint8",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
      });
      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Ortho Mode + Segmentation + Mapping %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
            dataTextureCount: 4,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "segmentationLayer",
            elementClass: "uint8",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: false,
      });

      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Arbitrary Mode (no segmentation available) %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
      });
      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Arbitrary Mode (segmentation available) %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
            dataTextureCount: 4,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "segmentationLayer",
            elementClass: "uint8",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: false,
      });
      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );

  shaderTest.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
    "Ortho Mode (rgb and float layer) %o",
    (getShader, { warnings }) => {
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 1.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint24",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 2,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "float",
          },
        },
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
      });
      parser.parse(code);
      expect(warnings.emittedCount).toBe(0);
    },
  );
});
