// @flow
import _ from "lodash";
import { OrthoViews } from "oxalis/constants";
import * as accessors from "oxalis/model/accessors/flycam2d_accessor";

describe("Flycam2D Accessors", () => {
  const initialState = {
    dataset: {
      scale: [1, 1, 2],
      dataLayers: [{
        resolutions: [1, 2, 4, 8, 16],
      }],
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
      currentMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        1223, 3218, 518, 1,
      ],
      spaceDirectionOrtho: [1, 1, 1],
    },
  };

  it("should calculate the ray threshold", () => {
    expect(accessors.getRayThreshold(initialState.flycam)).toBe(13);
  });

  it("should calculate the max zoom step", () => {
    expect(accessors.getMaxZoomStep(initialState)).toBe(17);
  });

  it("should calculate the integer zoom step", () => {
    expect(accessors.getIntegerZoomStep(initialState)).toBe(1);
  });

  it("should calculate the request log zoom step (1/3)", () => {
    expect(accessors.getRequestLogZoomStep(initialState)).toBe(1);
  });

  it("should calculate the request log zoom step (2/3)", () => {
    const state = _.cloneDeep(initialState);
    state.datasetConfiguration.quality = 1;
    expect(accessors.getRequestLogZoomStep(state)).toBe(2);
  });

  it("should calculate the request log zoom step (3/3)", () => {
    const state = _.cloneDeep(initialState);
    state.datasetConfiguration.quality = 1;
    state.flycam.zoomStep = 8;
    expect(accessors.getRequestLogZoomStep(state)).toBe(4);
  });

  it("should calculate the texture position", () => {
    const texturePosition = accessors.getTexturePosition(initialState, OrthoViews.PLANE_XZ);
    expect(texturePosition).toEqual([1216, 3218, 512]);
  });

  it("should calculate the texture scaling factor (1/2)", () => {
    const texturePosition = accessors.getTextureScalingFactor(initialState);
    expect(texturePosition).toEqual(0.65);
  });

  it("should calculate the texture scaling factor (2/2)", () => {
    const state = _.cloneDeep(initialState);
    state.datasetConfiguration.quality = 1;
    state.flycam.zoomStep = 8.6;

    const texturePosition = accessors.getTextureScalingFactor(state);
    expect(texturePosition).toEqual(0.5375);
  });

  it("should calculate the viewport bounding box", () => {
    const viewportBoundingBox = accessors.getViewportBoundingBox(initialState);
    expect(viewportBoundingBox.min).toEqual([973.4, 2968.4, 393.2]);
    expect(viewportBoundingBox.max).toEqual([1472.6, 3467.6, 642.8]);
  });

  it("should calculate the texture buffer", () => {
    const textureBuffer = accessors.calculateTextureBuffer(initialState);
    expect(textureBuffer[OrthoViews.PLANE_XY]).toEqual([262.4, 262.4]);
    expect(textureBuffer[OrthoViews.PLANE_XZ]).toEqual([262.4, 387.2]);
    expect(textureBuffer[OrthoViews.PLANE_YZ]).toEqual([387.2, 262.4]);
  });

  it("should calculate the offsets", () => {
    expect(accessors.getOffsets(initialState, OrthoViews.PLANE_XY))
    .toEqual([134.7, 140.2]);
    expect(accessors.getOffsets(initialState, OrthoViews.PLANE_XZ))
    .toEqual([134.7, 196.6]);
    expect(accessors.getOffsets(initialState, OrthoViews.PLANE_YZ))
    .toEqual([196.6, 140.2]);
  });

  it("should calculate the area", () => {
    expect(accessors.getArea(initialState, OrthoViews.PLANE_XY))
      .toEqual([134.7, 140.2, 384.3, 389.8]);
    expect(accessors.getArea(initialState, OrthoViews.PLANE_XZ))
      .toEqual([134.7, 196.6, 384.3, 321.4]);
    expect(accessors.getArea(initialState, OrthoViews.PLANE_YZ))
      .toEqual([196.6, 140.2, 321.4, 389.8]);
  });
});
