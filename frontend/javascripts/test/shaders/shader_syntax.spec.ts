import { parser } from "@shaderfrog/glsl-parser";
import mags from "test/fixtures/mags";
import getMainFragmentShader, {
  computeVertexBucketAlignmentLayerCap,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        voxelSizeFactorInverted: [1, 1, 1],
        useInterpolation: false,
        tpsTransformPerLayer: {},
        isWindows: false,
        vertexBucketAlignmentLayerCap: 8,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
        vertexBucketAlignmentLayerCap: 8,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });

    it<TestContext>("Ortho Mode (vertexBucketAlignmentLayerCap of 1, more layers than the cap)", ({
      warningEmittedCount,
    }) => {
      // The smallest cap (for GPUs with the WebGL2 minimum of varyings).
      const code = getShader({
        globalLayerCount: 3,
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
        isWindows: false,
        vertexBucketAlignmentLayerCap: 1,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
        vertexBucketAlignmentLayerCap: 8,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
        vertexBucketAlignmentLayerCap: 8,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: ["segmentationLayer"],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: false,
        useInterpolation: true,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: false,
        vertexBucketAlignmentLayerCap: 8,
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
        orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
        segmentationLayerNames: [],
        magnificationsCount: mags.length,
        voxelSizeFactor: [1, 1, 1],
        isOrthogonal: true,
        useInterpolation: false,
        voxelSizeFactorInverted: [1, 1, 1],
        tpsTransformPerLayer: {},
        isWindows: true,
        vertexBucketAlignmentLayerCap: 8,
      });
      parser.parse(code);
      expect(warningEmittedCount).toBe(0);
    });
  },
);

describe("computeVertexBucketAlignmentLayerCap", () => {
  it("stays below the layer counts that were measured to link in Chrome", () => {
    // Measured maximum: 24 layers with 32 varying vectors, 23 with 31; every
    // TPS layer reduces it by one.
    expect(computeVertexBucketAlignmentLayerCap(32, 0)).toBe(23);
    expect(computeVertexBucketAlignmentLayerCap(31, 0)).toBe(22);
    expect(computeVertexBucketAlignmentLayerCap(32, 4)).toBe(19);
    // WebGL2 minimum.
    expect(computeVertexBucketAlignmentLayerCap(15, 0)).toBe(6);
    expect(computeVertexBucketAlignmentLayerCap(15, 10)).toBe(1);
  });
});
