// @noflow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash";

import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import * as accessors from "oxalis/model/accessors/flycam_accessor";
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

  const maximumZoomPerResolution = accessors._getMaximumZoomForAllResolutions(scale, resolutions);

  // If this test case should fail at some point, the following values may be updated appropriately
  // to make it pass again. However, it should be validated that zooming out works as expected for
  // datasets with many magnifications (> 12). Small variations in these numbers shouldn't matter much.
  const expectedZoomValues = [
    1.6105100000000008,
    3.1384283767210035,
    5.559917313492239,
    8.954302432552389,
    17.449402268886445,
    34.003948586157826,
    66.26407607736661,
    142.04293198443185,
    276.80149049219943,
    539.4077978276367,
    1051.1531995000591,
    2253.240236044026,
    5313.0226118483115,
  ];

  t.deepEqual(maximumZoomPerResolution, expectedZoomValues);
});
