// @noflow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash";

import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import * as accessors from "oxalis/model/accessors/flycam_accessor";
import constants from "oxalis/constants";
import test from "ava";

const initialState = {
  dataset: {
    dataSource: {
      scale: [1, 1, 2],
      dataLayers: [
        {
          resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16]],
        },
        {
          resolutions: [[1, 1, 1], [2, 2, 2]],
        },
      ],
    },
  },
  datasetConfiguration: {
    quality: 0,
  },
  userConfiguration: {
    sphericalCapRadius: 100,
    dynamicSpaceDirection: true,
  },
  flycam: {
    zoomStep: 1.3,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1223, 3218, 518, 1],
    spaceDirectionOrtho: [1, 1, 1],
  },
};

test("Flycam Accessors should calculate the max zoom step", t => {
  t.is(getMaxZoomStep(initialState.dataset), 16);
});

test("Flycam Accessors should calculate the request log zoom step (1/3)", t => {
  t.is(accessors.getRequestLogZoomStep(initialState), 0);
});

test("Flycam Accessors should calculate the request log zoom step (2/3)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  t.is(accessors.getRequestLogZoomStep(state), 1);
});

test("Flycam Accessors should calculate the request log zoom step (3/3)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  state.flycam.zoomStep = 8;
  t.is(accessors.getRequestLogZoomStep(state), 4);
});

test("Flycam Accessors should calculate the texture scaling factor (1/2)", t => {
  const texturePosition = accessors.getTextureScalingFactor(initialState);
  t.deepEqual(texturePosition, 1.3);
});

test("Flycam Accessors should calculate the texture scaling factor (2/2)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  state.flycam.zoomStep = 8.6;

  const texturePosition = accessors.getTextureScalingFactor(state);
  t.deepEqual(texturePosition, 0.5375);
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
    scale,
    resolutions,
    rects,
  );

  // If this test case should fail at some point, the following values may be updated appropriately
  // to make it pass again. However, it should be validated that zooming out works as expected for
  // datasets with many magnifications (> 12). Small variations in these numbers shouldn't matter much.
  const expectedZoomValues = [
    1.3310000000000006,
    2.5937424601000028,
    4.594972986357223,
    7.4002499442581735,
    15.86309297171495,
    30.91268053287076,
    60.240069161242396,
    117.39085287969576,
    251.6377186292722,
    490.3707252978515,
    955.5938177273264,
    1862.1820132595253,
    4390.927778387033,
  ];

  t.deepEqual(maximumZoomPerResolution, expectedZoomValues);
});
