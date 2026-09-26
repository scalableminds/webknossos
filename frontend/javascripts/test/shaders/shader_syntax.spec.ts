import { parser } from "@shaderfrog/glsl-parser";
import mags from "test/fixtures/mags";
import getMainFragmentShader, {
  getMainVertexShader,
  type Params,
} from "viewer/shaders/main_data_shaders.glsl";
import { beforeEach, describe, expect, it } from "vitest";

type ShaderFunction = (params: Params) => string;

describe.for<ShaderFunction>([getMainFragmentShader, getMainVertexShader])(
  "Shader Syntax %o",
  (getShader) => {
    const originalWarn = console.warn;

    interface TestContext {
      warningEmittedCount: number;
    }

    beforeEach<TestContext>(async (context) => {
      console.warn = (...args: any[]) => {
        context.warningEmittedCount++;
        originalWarn(...args);
      };
      context.warningEmittedCount = 0;
    });

    it<TestContext>("Ortho Mode", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        voxelSizeFactorInverted: [1, 1, 1],
        useInterpolation: false,
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: false,
      });

      /*
       * If the code contains a syntax error, parse() will throw an exception
       * which makes the test fail.
       * If a warning was emitted during parsing, the `warningEmittedCount`
       * will reflect this.
       */
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode + Segmentation - Mapping", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: true,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode + Segmentation + Mapping", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: true,
      });

      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Flight Mode (no segmentation available)", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: true,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Flight Mode (segmentation available)", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: false,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode (rgb and float layer)", ({ warningEmittedCount }) => {
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
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: true,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode (int32 and uint32 layers)", ({ warningEmittedCount }) => {
      // Exercises the runtime dtypeTag branches (int32/uint32 bit-punned
      // min/max decoding) in the color-blending loop.
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 1.0,
            dataTextureCount: 1,
            isSigned: true,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "int32",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 1.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint32",
          },
        },
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: false,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode (many declared layers, fewer than maxActiveColorLayers)", ({
      warningEmittedCount,
    }) => {
      // Exercises the case the layerAlpha/layerMin/.../colorRenderOrder
      // arrays exist for: many more color layers declared than can be
      // simultaneously active, which toggling/reordering should handle via
      // uniform updates alone (see PlaneMaterialFactory.getColorRenderOrder).
      const colorLayerNames = Array.from({ length: 20 }, (_, i) => `color_layer_${i}`);
      const textureLayerInfos: Params["textureLayerInfos"] = Object.fromEntries(
        colorLayerNames.map((name) => [
          name,
          {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "" as const,
            unsanitizedName: name,
            elementClass: "uint8" as const,
          },
        ]),
      );
      const code = getShader({
        globalLayerCount: colorLayerNames.length,
        colorLayerNames,
        textureLayerInfos,
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 8,
        isWindows: false,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode (vertexBucketAlignmentLayerCap smaller than 1, worst-case hardware)", ({
      warningEmittedCount,
    }) => {
      // Regression test: outputMagIdx/outputSeed/outputAddress used to be
      // varyings sized by globalLayerCount, which could exceed the driver's
      // varying budget ("Could not pack varying") on datasets with many
      // layers -- see vertexAlignmentLayerCap in main_data_shaders.glsl.ts.
      // Exercise the smallest possible cap (matching the WebGL2-guaranteed
      // worst case) with more declared layers than that.
      const colorLayerNames = Array.from({ length: 5 }, (_, i) => `color_layer_${i}`);
      const textureLayerInfos: Params["textureLayerInfos"] = Object.fromEntries(
        colorLayerNames.map((name) => [
          name,
          {
            isColor: true,
            packingDegree: 4.0,
            dataTextureCount: 1,
            isSigned: false,
            glslPrefix: "" as const,
            unsanitizedName: name,
            elementClass: "uint8" as const,
          },
        ]),
      );
      const code = getShader({
        globalLayerCount: colorLayerNames.length,
        colorLayerNames,
        textureLayerInfos,
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        maxActiveColorLayers: 8,
        vertexBucketAlignmentLayerCap: 1,
        isWindows: false,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });
  },
);
