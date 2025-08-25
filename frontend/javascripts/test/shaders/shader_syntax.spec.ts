import getMainFragmentShader from "viewer/shaders/main_data_shaders.glsl";
import mags from "test/fixtures/mags";
import { describe, it, beforeEach, expect } from "vitest";
import { parser } from "@shaderfrog/glsl-parser";

describe("Shader syntax", () => {
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
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: [],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: true,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
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
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
        ["segmentationLayer"]: {
          isColor: true,
          packingDegree: 1.0,
          dataTextureCount: 4,
          isSigned: false,
          glslPrefix: "",
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: ["segmentationLayer"],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: true,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
    });
    parser.parse(code);
    expect(warningEmittedCount).toBe(0);
  });

  it<TestContext>("Ortho Mode + Segmentation + Mapping", ({ warningEmittedCount }) => {
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
        ["segmentationLayer"]: {
          isColor: false,
          packingDegree: 1.0,
          dataTextureCount: 4,
          isSigned: false,
          glslPrefix: "",
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: ["segmentationLayer"],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: true,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
    });

    parser.parse(code);
    expect(warningEmittedCount).toBe(0);
  });

  it<TestContext>("Arbitrary Mode (no segmentation available)", ({ warningEmittedCount }) => {
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: [],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: false,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
    });
    parser.parse(code);
    expect(warningEmittedCount).toBe(0);
  });

  it<TestContext>("Arbitrary Mode (segmentation available)", ({ warningEmittedCount }) => {
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
        ["segmentationLayer"]: {
          isColor: false,
          packingDegree: 1.0,
          dataTextureCount: 4,
          isSigned: false,
          glslPrefix: "",
          unsanitizedName: "color_layer_1",
          elementClass: "uint8",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: ["segmentationLayer"],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: false,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
    });
    parser.parse(code);
    expect(warningEmittedCount).toBe(0);
  });

  it<TestContext>("Ortho Mode (rgb and float layer)", ({ warningEmittedCount }) => {
    const code = getMainFragmentShader({
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
          unsanitizedName: "color_layer_1",
          elementClass: "float",
        },
      },
      orderedColorLayerNames: ["color_layer_1", "color_layer_2"],
      segmentationLayerNames: [],
      magnificationsCount: mags.length,
      voxelSizeFactor: [1, 1, 1],
      isOrthogonal: true,
      voxelSizeFactorInverted: [1, 1, 1],
      tpsTransformPerLayer: {},
    });
    parser.parse(code);
    expect(warningEmittedCount).toBe(0);
  });
});
