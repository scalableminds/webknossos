import update from "immutability-helper";
import { initialState } from "test/fixtures/hybridtracing_object";
import type { CoordinateTransformation } from "types/api_types";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { AnnotationTool, VolumeTools } from "viewer/model/accessors/tool_accessor";
import { describe, expect, it } from "vitest";

const zoomSensitiveVolumeTools = VolumeTools.filter(
  (name) => name !== AnnotationTool.VOXEL_PIPETTE,
) as AnnotationTool[];

const zoomedInInitialState = update(initialState, {
  flycam: { zoomStep: { $set: 0.1 } },
});

const zoomedOutState = update(initialState, {
  flycam: {
    zoomStep: { $set: 15000.0 },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        [0]: {
          // More mags are needed to reach the state where all tools are disabled.
          mags: {
            $set: [
              { mag: [1, 1, 1] },
              { mag: [2, 2, 2] },
              { mag: [4, 4, 4] },
              { mag: [8, 8, 8] },
              { mag: [16, 16, 16] },
              { mag: [32, 32, 32] },
              { mag: [64, 64, 64] },
            ],
          },
        },
        [1]: {
          mags: {
            $set: [
              { mag: [1, 1, 1] },
              { mag: [2, 2, 2] },
              { mag: [4, 4, 4] },
              { mag: [8, 8, 8] },
              { mag: [16, 16, 16] },
              { mag: [32, 32, 32] },
              { mag: [64, 64, 64] },
            ],
          },
        },
      },
    },
  },
});

const coordinateTransformations: CoordinateTransformation[] = [
  {
    type: "affine",
    matrix: [
      [1, 0, 0, -128],
      [0, 1, 0, -128],
      [0, 0, 1, -128],
      [0, 0, 0, 1],
    ],
  },
  {
    type: "affine",
    matrix: [
      [1, 0, 0, 0],
      [0, 0, -1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ],
  },
  {
    type: "affine",
    matrix: [
      [-1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, -1, 0],
      [0, 0, 0, 1],
    ],
  },
  {
    type: "affine",
    matrix: [
      [-1, 0, 0, 0],
      [0, -1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
  },
  {
    type: "affine",
    matrix: [
      [1, 0, 0, 128],
      [0, 1, 0, 128],
      [0, 0, 1, 128],
      [0, 0, 0, 1],
    ],
  },
];

const rotatedState = update(initialState, {
  dataset: {
    dataSource: {
      dataLayers: {
        [0]: {
          coordinateTransformations: {
            $set: coordinateTransformations,
          },
        },
        [1]: {
          coordinateTransformations: {
            $set: coordinateTransformations,
          },
        },
      },
    },
  },
});

describe("Annotation Tool Disabled Info", () => {
  it("Zoomed in main tools should be enabled.", () => {
    const disabledInfo = getDisabledInfoForTools(zoomedInInitialState);

    for (const tool of Object.values(AnnotationTool)) {
      if (tool === AnnotationTool.PROOFREAD) {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(true);
      } else {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(false);
      }
    }
  });

  it("Volume tools should be disabled when zoomed out.", () => {
    const disabledInfo = getDisabledInfoForTools(zoomedOutState);

    for (const tool of Object.values(AnnotationTool)) {
      if (
        tool === AnnotationTool.PROOFREAD ||
        zoomSensitiveVolumeTools.includes(tool as AnnotationTool)
      ) {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(true);
      } else {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(false);
      }
    }
  });

  it("Tools should be disabled when dataset is rotated", () => {
    const toolsDisregardingRotation = [
      AnnotationTool.MOVE,
      AnnotationTool.LINE_MEASUREMENT,
      AnnotationTool.AREA_MEASUREMENT,
      AnnotationTool.VOXEL_PIPETTE,
    ] as AnnotationTool[];
    const disabledInfo = getDisabledInfoForTools(rotatedState);
    for (const tool of Object.values(AnnotationTool)) {
      if (toolsDisregardingRotation.includes(tool)) {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(false);
      } else {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(true);
      }
    }
  });
  it("Tools should not be disabled when dataset rotation is toggled off", () => {
    const rotationTurnedOffState = update(rotatedState, {
      datasetConfiguration: {
        nativelyRenderedLayerName: { $set: rotatedState.dataset.dataSource.dataLayers[0].name },
      },
    });
    const disabledInfo = getDisabledInfoForTools(rotationTurnedOffState);
    for (const tool of Object.values(AnnotationTool)) {
      if (tool === AnnotationTool.PROOFREAD) {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(true);
      } else {
        expect(disabledInfo[tool.id]?.isDisabled).toBe(false);
      }
    }
  });
});
