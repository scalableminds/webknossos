import { parser } from "@shaderfrog/glsl-parser";
import range from "lodash-es/range";
import mags from "test/fixtures/mags";
import type { ElementClass } from "types/api_types";
import { getDtypeConfigForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import getMainFragmentShader, {
  computeVertexBucketAlignmentLayerCap,
  estimateUniformVectors,
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
            isSigned: false,
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
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
            isSigned: false,
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: true,
            packingDegree: 1.0,
            isSigned: false,
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
            isSigned: false,
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
            isSigned: false,
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
            isSigned: false,
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
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
            isSigned: false,
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
            isSigned: false,
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
            isSigned: false,
            elementClass: "uint24",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
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
      // Covers the int32/uint32 branches of the color-blending loop.
      const code = getShader({
        globalLayerCount: 2,
        colorLayerNames: ["color_layer_1", "color_layer_2"],
        textureLayerInfos: {
          ["color_layer_1"]: {
            isColor: true,
            packingDegree: 1.0,
            isSigned: true,
            elementClass: "int32",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 1.0,
            isSigned: false,
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

    it<TestContext>("Ortho Mode (more declared layers than maxActiveColorLayers)", ({
      warningEmittedCount,
    }) => {
      const colorLayerNames = Array.from({ length: 20 }, (_, i) => `color_layer_${i}`);
      const textureLayerInfos: Params["textureLayerInfos"] = Object.fromEntries(
        colorLayerNames.map((name) => [
          name,
          {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
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

    it<TestContext>("Ortho Mode (vertexBucketAlignmentLayerCap of 1, more layers than the cap)", ({
      warningEmittedCount,
    }) => {
      // The smallest cap (for GPUs with the WebGL2 minimum of varyings), with
      // more layers than the cap.
      const colorLayerNames = Array.from({ length: 5 }, (_, i) => `color_layer_${i}`);
      const textureLayerInfos: Params["textureLayerInfos"] = Object.fromEntries(
        colorLayerNames.map((name) => [
          name,
          {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
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

// Counts the uniform vectors that the code declares and uses: one per scalar
// or vector, one per row of a matrix, times the length of an array. Matches
// Chrome's (ANGLE's) count within one vector.
const UNIFORM_DECLARATION =
  /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(?:\[(\d+)\])?\s*;/gm;
function countUsedUniformVectors(code: string): number {
  const codeWithoutDeclarations = code.replace(UNIFORM_DECLARATION, "");
  let count = 0;
  for (const [, type, name, arrayLength] of code.matchAll(UNIFORM_DECLARATION)) {
    const isUsed = new RegExp(`\\b${name}\\b`).test(codeWithoutDeclarations);
    if (type.includes("sampler") || !isUsed) {
      continue;
    }
    const vectorsPerElement = type.startsWith("mat") ? Number(type[3]) : 1;
    count += vectorsPerElement * (arrayLength != null ? Number(arrayLength) : 1);
  }
  return count;
}

function getUniformTestParams(
  elementClass: ElementClass,
  colorLayerCount: number,
  hasSegmentation: boolean,
  magnificationCount: number,
): Params {
  const getTextureLayerInfo = (name: string, elementClass: ElementClass, isColor: boolean) => {
    const { packingDegree, glslPrefix, isSigned } = getDtypeConfigForElementClass(elementClass);
    return { isColor, packingDegree, glslPrefix, isSigned, unsanitizedName: name, elementClass };
  };
  const colorLayerNames = range(colorLayerCount).map((i) => `color_layer_${i}`);
  const segmentationLayerNames = hasSegmentation ? ["segmentation_layer"] : [];
  return {
    globalLayerCount: colorLayerNames.length + segmentationLayerNames.length,
    colorLayerNames,
    textureLayerInfos: Object.fromEntries([
      ...colorLayerNames.map((name) => [name, getTextureLayerInfo(name, elementClass, true)]),
      ...segmentationLayerNames.map((name) => [name, getTextureLayerInfo(name, "uint64", false)]),
    ]),
    segmentationLayerNames,
    magnificationsCount: magnificationCount,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    voxelSizeFactorInverted: [1, 1, 1],
    useInterpolation: false,
    tpsTransformPerLayer: {},
    isWindows: false,
    maxActiveColorLayers: 32,
    vertexBucketAlignmentLayerCap: 8,
  };
}

describe("estimateUniformVectors", () => {
  it("matches the uniforms of the generated shaders", () => {
    for (const elementClass of ["uint8", "uint16", "uint32", "float"] as const) {
      for (const [colorLayerCount, hasSegmentation, magnificationCount] of [
        [1, false, 5],
        [5, true, 30],
        [30, true, 300],
      ] as const) {
        const globalLayerCount = colorLayerCount + (hasSegmentation ? 1 : 0);
        const params = getUniformTestParams(
          elementClass,
          colorLayerCount,
          hasSegmentation,
          magnificationCount,
        );
        const estimate = estimateUniformVectors(
          globalLayerCount,
          magnificationCount,
          hasSegmentation,
        );
        // If this fails, the shader's uniforms changed: update the constants
        // in main_data_shaders.glsl.ts.
        expect(countUsedUniformVectors(getMainFragmentShader(params))).toBe(estimate);
        expect(countUsedUniformVectors(getMainVertexShader(params))).toBeLessThanOrEqual(estimate);
      }
    }
  });
});
