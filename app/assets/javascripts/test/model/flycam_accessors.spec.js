/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import test from "ava";
import _ from "lodash";
import { OrthoViews } from "oxalis/constants";
import * as accessors from "oxalis/model/accessors/flycam_accessor";

const initialState = {
  dataset: {
    scale: [1, 1, 2],
    dataLayers: [
      {
        resolutions: [1, 2, 4, 8, 16],
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
  t.is(accessors.getMaxZoomStep(initialState), 17);
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
  const texturePosition = accessors.getTexturePosition(initialState, OrthoViews.PLANE_XZ);
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
  t.deepEqual(viewportBoundingBox.min, [973.4, 2968.4, 393.2]);
  t.deepEqual(viewportBoundingBox.max, [1472.6, 3467.6, 642.8]);
});

test("Flycam Accessors should calculate the texture buffer", t => {
  const textureBuffer = accessors.calculateTextureBuffer(initialState);
  t.deepEqual(textureBuffer[OrthoViews.PLANE_XY], [262.4, 262.4]);
  t.deepEqual(textureBuffer[OrthoViews.PLANE_XZ], [262.4, 387.2]);
  t.deepEqual(textureBuffer[OrthoViews.PLANE_YZ], [387.2, 262.4]);
});

test("Flycam Accessors should calculate the offsets", t => {
  t.deepEqual(accessors.getOffsets(initialState, OrthoViews.PLANE_XY), [134.7, 140.2]);
  t.deepEqual(accessors.getOffsets(initialState, OrthoViews.PLANE_XZ), [134.7, 196.6]);
  t.deepEqual(accessors.getOffsets(initialState, OrthoViews.PLANE_YZ), [196.6, 140.2]);
});

test("Flycam Accessors should calculate the area", t => {
  t.deepEqual(accessors.getArea(initialState, OrthoViews.PLANE_XY), [134.7, 140.2, 384.3, 389.8]);
  t.deepEqual(accessors.getArea(initialState, OrthoViews.PLANE_XZ), [134.7, 196.6, 384.3, 321.4]);
  t.deepEqual(accessors.getArea(initialState, OrthoViews.PLANE_YZ), [196.6, 140.2, 321.4, 389.8]);
});
