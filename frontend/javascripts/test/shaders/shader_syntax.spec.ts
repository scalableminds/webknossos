import { parser } from "@shaderfrog/glsl-parser";
import range from "lodash-es/range";
import mags from "test/fixtures/mags";
import type { ElementClass } from "types/api_types";
import { getDtypeConfigForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import getMainFragmentShader, {
  computeUniformColorLayerCap,
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
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: true,
            packingDegree: 1.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: true,
            packingDegree: 1.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint8",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_2",
            elementClass: "uint8",
          },
          ["segmentationLayer"]: {
            isColor: false,
            packingDegree: 1.0,
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
            isSigned: false,
            glslPrefix: "",
            unsanitizedName: "color_layer_1",
            elementClass: "uint24",
          },
          ["color_layer_2"]: {
            isColor: true,
            packingDegree: 4.0,
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
  renderedColorLayerCount: number,
  hasSegmentation: boolean,
  globalLayerCount: number,
  magnificationCount: number,
): Params {
  const getTextureLayerInfo = (name: string, elementClass: ElementClass, isColor: boolean) => {
    const { packingDegree, glslPrefix, isSigned } = getDtypeConfigForElementClass(elementClass);
    return { isColor, packingDegree, glslPrefix, isSigned, unsanitizedName: name, elementClass };
  };
  const colorLayerNames = range(renderedColorLayerCount).map((i) => `color_layer_${i}`);
  const segmentationLayerNames = hasSegmentation ? ["segmentation_layer"] : [];
  return {
    globalLayerCount,
    colorLayerNames,
    textureLayerInfos: Object.fromEntries([
      ...colorLayerNames.map((name) => [name, getTextureLayerInfo(name, elementClass, true)]),
      ...segmentationLayerNames.map((name) => [name, getTextureLayerInfo(name, "uint64", false)]),
    ]),
    orderedColorLayerNames: colorLayerNames,
    segmentationLayerNames,
    magnificationsCount: magnificationCount,
    voxelSizeFactor: [1, 1, 1],
    isOrthogonal: true,
    voxelSizeFactorInverted: [1, 1, 1],
    useInterpolation: false,
    tpsTransformPerLayer: {},
    isWindows: false,
    vertexBucketAlignmentLayerCap: 8,
  };
}

describe("estimateUniformVectors", () => {
  it("matches the uniforms of the generated shaders", () => {
    for (const elementClass of ["uint8", "uint16", "uint32", "float"] as const) {
      for (const [
        renderedColorLayerCount,
        hasSegmentation,
        hiddenLayerCount,
        magnificationCount,
      ] of [
        [1, false, 0, 5],
        [5, true, 0, 30],
        [20, true, 40, 300],
      ] as const) {
        const globalLayerCount =
          renderedColorLayerCount + (hasSegmentation ? 1 : 0) + hiddenLayerCount;
        const params = getUniformTestParams(
          elementClass,
          renderedColorLayerCount,
          hasSegmentation,
          globalLayerCount,
          magnificationCount,
        );
        const estimate = estimateUniformVectors(
          globalLayerCount,
          magnificationCount,
          renderedColorLayerCount,
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

describe("computeUniformColorLayerCap", () => {
  it("keeps the shaders within the uniform limit", () => {
    for (const [maxUniformVectors, globalLayerCount, magnificationCount, hasSegmentation] of [
      [224, 3, 30, true],
      [256, 10, 60, false],
      [1024, 20, 200, true],
      [1024, 40, 400, false],
      [4096, 100, 1000, true],
    ] as const) {
      const cap = computeUniformColorLayerCap(
        maxUniformVectors,
        globalLayerCount,
        magnificationCount,
        hasSegmentation,
      );
      const renderedColorLayerCount = Math.min(cap, globalLayerCount - (hasSegmentation ? 1 : 0));
      expect(
        estimateUniformVectors(
          globalLayerCount,
          magnificationCount,
          renderedColorLayerCount,
          hasSegmentation,
        ),
      ).toBeLessThanOrEqual(maxUniformVectors);
    }
  });

  it("returns 1 if not even one color layer fits", () => {
    // The magnifications and per-layer arrays alone exceed the limit. Such
    // datasets fail to render on master, too.
    expect(computeUniformColorLayerCap(224, 20, 200, true)).toBe(1);
    expect(computeUniformColorLayerCap(256, 40, 400, false)).toBe(1);
  });

  it("allows all layers of typical datasets on desktop GPUs", () => {
    // 2 color layers and a segmentation layer, 10 magnifications each.
    expect(computeUniformColorLayerCap(1024, 3, 30, true)).toBeGreaterThanOrEqual(2);
    // 30 color layers and a segmentation layer, 8 magnifications each.
    expect(computeUniformColorLayerCap(1024, 31, 248, true)).toBeGreaterThanOrEqual(30);
  });

  it("lowers the count at the WebGL2 minimum", () => {
    // 224 - 8 (headroom) - 17 - 30 - 15 - 51 = 103 vectors for color layers.
    expect(computeUniformColorLayerCap(224, 3, 30, true)).toBe(7);
  });
});
