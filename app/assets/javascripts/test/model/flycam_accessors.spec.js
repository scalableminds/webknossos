/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import _ from "lodash";
import { OrthoViews } from "oxalis/constants";
import * as accessors from "oxalis/model/accessors/flycam_accessor";
import resolutions from "test/fixtures/resolutions";

const initialState = {
  dataset: {
    scale: [1, 1, 2],
    dataLayers: [
      {
        resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16]],
      },
    ],
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
  t.is(accessors.getMaxZoomStep(initialState), 16);
});

test("Flycam Accessors should calculate the integer zoom step", t => {
  t.is(accessors.getIntegerZoomStep(initialState), 1);
});

test("Flycam Accessors should calculate the request log zoom step (1/3)", t => {
  t.is(accessors.getRequestLogZoomStep(initialState), 1);
});

test("Flycam Accessors should calculate the request log zoom step (2/3)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  t.is(accessors.getRequestLogZoomStep(state), 2);
});

test("Flycam Accessors should calculate the request log zoom step (3/3)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  state.flycam.zoomStep = 8;
  t.is(accessors.getRequestLogZoomStep(state), 4);
});

test("Flycam Accessors should calculate the texture position", t => {
  const texturePosition = accessors.getTexturePosition(
    initialState,
    OrthoViews.PLANE_XZ,
    resolutions,
  );
  t.deepEqual(texturePosition, [1216, 3218, 512]);
});

test("Flycam Accessors should calculate the texture scaling factor (1/2)", t => {
  const texturePosition = accessors.getTextureScalingFactor(initialState);
  t.deepEqual(texturePosition, 0.65);
});

test("Flycam Accessors should calculate the texture scaling factor (2/2)", t => {
  const state = _.cloneDeep(initialState);
  state.datasetConfiguration.quality = 1;
  state.flycam.zoomStep = 8.6;

  const texturePosition = accessors.getTextureScalingFactor(state);
  t.deepEqual(texturePosition, 0.5375);
});

test("Flycam Accessors should calculate the viewport bounding box", t => {
  const viewportBoundingBox = accessors.getViewportBoundingBox(initialState);
  t.deepEqual(viewportBoundingBox.min, [978.6, 2973.6, 395.8]);
  t.deepEqual(viewportBoundingBox.max, [1467.4, 3462.4, 640.2]);
});
