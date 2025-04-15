import "test/mocks/lz4";
import update from "immutability-helper";
import test from "ava";
import { getDisabledInfoForTools } from "oxalis/model/accessors/tool_accessor";
import { initialState } from "test/fixtures/hybridtracing_object";
import { AnnotationToolEnum, VolumeTools } from "oxalis/constants";
import type { CoordinateTransformation } from "types/api_flow_types";

const zoomSensitiveVolumeTools = VolumeTools.filter(
  (name) => name !== AnnotationToolEnum.PICK_CELL,
) as AnnotationToolEnum[];

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
          // More resolutions are needed to reach the state where all tools are disabled.
          resolutions: {
            $set: [
              [1, 1, 1],
              [2, 2, 2],
              [4, 4, 4],
              [8, 8, 8],
              [16, 16, 16],
              [32, 32, 32],
              [64, 64, 64],
            ],
          },
        },
        [1]: {
          resolutions: {
            $set: [
              [1, 1, 1],
              [2, 2, 2],
              [4, 4, 4],
              [8, 8, 8],
              [16, 16, 16],
              [32, 32, 32],
              [64, 64, 64],
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

test("Zoomed in main tools should be enabled.", (t) => {
  const disabledInfo = getDisabledInfoForTools(zoomedInInitialState);

  for (const toolName in AnnotationToolEnum) {
    if (toolName === AnnotationToolEnum.PROOFREAD) {
      t.assert(disabledInfo[toolName]?.isDisabled === true);
    } else {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === false);
    }
  }
});

test("Volume tools should be disabled when zoomed out.", (t) => {
  const disabledInfo = getDisabledInfoForTools(zoomedOutState);

  for (const toolName in AnnotationToolEnum) {
    if (
      toolName === AnnotationToolEnum.PROOFREAD ||
      zoomSensitiveVolumeTools.includes(toolName as AnnotationToolEnum)
    ) {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === true);
    } else {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === false);
    }
  }
});

test("Tools should be disabled when dataset is rotated", (t) => {
  const toolsDisregardingRotation = [
    AnnotationToolEnum.MOVE,
    AnnotationToolEnum.LINE_MEASUREMENT,
    AnnotationToolEnum.AREA_MEASUREMENT,
  ];
  const disabledInfo = getDisabledInfoForTools(rotatedState);
  for (const toolName in AnnotationToolEnum) {
    if (toolsDisregardingRotation.includes(toolName as AnnotationToolEnum)) {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === false);
    } else {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === true);
    }
  }
});

test("Tools should not be disabled when dataset rotation is toggled off", (t) => {
  const rotationTurnedOffState = update(rotatedState, {
    datasetConfiguration: {
      nativelyRenderedLayerName: { $set: rotatedState.dataset.dataSource.dataLayers[0].name },
    },
  });
  const disabledInfo = getDisabledInfoForTools(rotationTurnedOffState);
  for (const toolName in AnnotationToolEnum) {
    if (toolName === AnnotationToolEnum.PROOFREAD) {
      t.assert(disabledInfo[toolName]?.isDisabled === true);
    } else {
      t.assert(disabledInfo[toolName as AnnotationToolEnum]?.isDisabled === false);
    }
  }
});
