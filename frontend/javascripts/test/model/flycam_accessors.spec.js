// @flow
import _ from "lodash";

import type { OxalisState } from "oxalis/store";
import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import * as accessors from "oxalis/model/accessors/flycam_accessor";
import constants from "oxalis/constants";
import test from "ava";
import defaultState from "oxalis/default_state";

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
      scale: [1, 1, 2],
      dataLayers: [
        {
          name: "layer1",
          boundingBox,
          elementClass: "uint8",
          resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16]],
          category: "color",
        },
        {
          name: "layer2",
          boundingBox,
          elementClass: "uint8",
          resolutions: [[1, 1, 1], [2, 2, 2]],
          category: "color",
        },
      ],
    },
  },
  datasetConfiguration: {
    ...defaultState.datasetConfiguration,
  },
  userConfiguration: {
    ...defaultState.userConfiguration,
    sphericalCapRadius: 100,
    dynamicSpaceDirection: true,
  },
  flycam: {
    ...defaultState.flycam,
    zoomStep: 1.3,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1223, 3218, 518, 1],
    spaceDirectionOrtho: [1, 1, 1],
  },
};

test("Flycam Accessors should calculate the max zoom step", t => {
  t.is(getMaxZoomStep(initialState.dataset), 16);
});

test("Flycam Accessors should calculate the request log zoom step (1/2)", t => {
  t.is(accessors.getRequestLogZoomStep(initialState), 0);
});

test("Flycam Accessors should calculate the request log zoom step (2/2)", t => {
  const state = _.cloneDeep(initialState);
  // $FlowFixMe[cannot-write]
  state.flycam.zoomStep = 8;
  t.is(accessors.getRequestLogZoomStep(state), 3);
});

test.only("Flycam Accessors should calculate appropriate zoom factors for datasets with many magnifications.", t => {
  const scale = [4, 4, 35];
  const resolutions = [
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

  const rect = { width: 384, height: 384, top: 0, left: 0 };

  const rects = {
    PLANE_XY: rect,
    PLANE_YZ: rect,
    PLANE_XZ: rect,
    TDView: rect,
  };

  const maximumZoomPerResolution = accessors._getMaximumZoomForAllResolutions(
    constants.MODE_PLANE_TRACING,
    "BEST_QUALITY_FIRST",
    scale,
    resolutions,
    rects,
    DEFAULT_REQUIRED_BUCKET_CAPACITY,
    DEFAULT_GPU_MEMORY_FACTOR,
  );

  // If this test case should fail at some point, the following values may be updated appropriately
  // to make it pass again. However, it should be validated that zooming out works as expected for
  // datasets with many magnifications (> 12). Small variations in these numbers shouldn't matter much.
  const expectedZoomValues = [
    1.3309999999999997,
    2.593742460100001,
    4.177248169415654,
    7.400249944258169,
    15.863092971714945,
    30.912680532870745,
    60.24006916124236,
    117.39085287969571,
    251.63771862927217,
    490.3707252978515,
    955.5938177273264,
    2048.400214585478,
    4390.927778387033,
  ];

  t.deepEqual(maximumZoomPerResolution, expectedZoomValues);
});
