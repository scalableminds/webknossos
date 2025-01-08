import test from "ava";
import _ from "lodash";
import constants, { Identity4x4, UnitLong, type Vector3 } from "oxalis/constants";
import defaultState from "oxalis/default_state";
import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import * as accessors from "oxalis/model/accessors/flycam_accessor";
import type { OxalisState } from "oxalis/store";
const { GPU_FACTOR_MULTIPLIER, DEFAULT_GPU_MEMORY_FACTOR } = constants;
const DEFAULT_REQUIRED_BUCKET_CAPACITY = GPU_FACTOR_MULTIPLIER * DEFAULT_GPU_MEMORY_FACTOR;
const boundingBox = {
  topLeft: [0, 0, 0],
  width: 100,
  height: 100,
  depth: 100,
};
const initialState: OxalisState = {
  ...defaultState,
  dataset: {
    ...defaultState.dataset,
    dataSource: {
      ...defaultState.dataset.dataSource,
      scale: { factor: [1, 1, 2], unit: UnitLong.nm },
      dataLayers: [
        {
          name: "layer1",
          // @ts-expect-error ts-migrate(2322) FIXME: Type '{ topLeft: number[]; width: number; height: ... Remove this comment to see the full error message
          boundingBox,
          elementClass: "uint8",
          resolutions: [
            [1, 1, 1],
            [2, 2, 2],
            [4, 4, 4],
            [8, 8, 8],
            [16, 16, 16],
          ],
          category: "color",
        },
        {
          name: "layer2",
          // @ts-expect-error ts-migrate(2322) FIXME: Type '{ topLeft: number[]; width: number; height: ... Remove this comment to see the full error message
          boundingBox,
          elementClass: "uint8",
          resolutions: [
            [1, 1, 1],
            [2, 2, 2],
          ],
          category: "color",
        },
      ],
    },
  },
  datasetConfiguration: { ...defaultState.datasetConfiguration },
  userConfiguration: {
    ...defaultState.userConfiguration,
    sphericalCapRadius: 100,
    dynamicSpaceDirection: true,
  },
  flycam: {
    ...defaultState.flycam,
    zoomStep: 1.0,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1223, 3218, 518, 1],
    spaceDirectionOrtho: [1, 1, 1],
  },
};
test("Flycam Accessors should calculate the max zoom step", (t) => {
  t.is(getMaxZoomStep(initialState.dataset), 16);
});

test("Flycam Accessors should calculate the request log zoom step (1/2)", (t) => {
  t.is(accessors.getActiveMagIndexForLayer(initialState, "layer1"), 0);
});

test("Flycam Accessors should calculate the request log zoom step (2/2)", (t) => {
  const state = _.cloneDeep(initialState);

  // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'zoomStep' because it is a read-o... Remove this comment to see the full error message
  state.flycam.zoomStep = 8;
  t.is(accessors.getActiveMagIndexForLayer(state, "layer1"), 3);
});

test("Flycam Accessors should calculate appropriate zoom factors for datasets with many magnifications.", (t) => {
  const scale: Vector3 = [4, 4, 35];
  const mags: Vector3[] = [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 1],
    [8, 8, 1],
    [16, 16, 2],
    [32, 32, 4],
    [64, 64, 8],
    [128, 128, 16],
    [256, 256, 32],
    [512, 512, 64],
    [1024, 1024, 128],
    [2048, 2048, 256],
    [4096, 4096, 512],
  ];
  const rect = {
    width: 384,
    height: 384,
    top: 0,
    left: 0,
  };
  const rects = {
    PLANE_XY: rect,
    PLANE_YZ: rect,
    PLANE_XZ: rect,
    TDView: rect,
  };

  const maximumZoomPerMags = accessors._getMaximumZoomForAllMags(
    constants.MODE_PLANE_TRACING,
    "BEST_QUALITY_FIRST",
    scale,
    mags,
    rects,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
    Identity4x4,
    accessors._getDummyFlycamMatrix(scale),
  );

  // If this test case should fail at some point, the following values may be updated appropriately
  // to make it pass again. However, it should be validated that zooming out works as expected for
  // datasets with many magnifications (> 12). Small variations in these numbers shouldn't matter much.
  // biome-ignore format: don't format array
  const expectedZoomValues = [
    1.9487171,
    3.4522712143931016,
    5.559917313492236,
    9.849732675807626,
    21.113776745352595,
    41.144777789250966,
    80.1795320536136,
    156.24722518287504,
    334.9298034955614,
    652.6834353714405,
    1271.8953713950718,
    2726.4206856132723,
    6428.757360336458,
  ];
  t.deepEqual(maximumZoomPerMags, expectedZoomValues);
});
