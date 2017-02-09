/**
 * flycam2d.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import type { BoundingBoxType } from "oxalis/model";
import User from "oxalis/model/user";
import scaleInfo from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import constants, { OrthoViews } from "oxalis/constants";
import type { Vector2, Vector3, Vector4, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import Model from "oxalis/model";

const Flycam2dConstants = {
  // maximum difference between requested coordinate and actual texture position
  MAX_TEXTURE_OFFSET: 31,
  MAX_ZOOM_THRESHOLD: 2,
  PIXEL_RAY_THRESHOLD: 10,
};

class Flycam2d {

  viewportWidth: number;
  zoomStepCount: number;
  model: Model;
  user: User;
  maxZoomStepDiff: number;
  zoomStep: number;
  integerZoomStep: number;
  buffer: OrthoViewMapType<Vector2>;
  position: Vector3;
  direction: Vector3;
  rayThreshold: Vector4;
  spaceDirection: Vector3;
  quality: number;
  voxelPerPixel3DView: number;

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  constructor(viewportWidth: number, zoomStepCount: number, model: Model) {
    this.viewportWidth = viewportWidth;
    this.zoomStepCount = zoomStepCount;
    this.model = model;
    _.extend(this, Backbone.Events);

    console.log("ZoomStepCount: ", this.zoomStepCount);

    this.user = this.model.user;

    this.maxZoomStepDiff = this.calculateMaxZoomStepDiff();
    this.zoomStep = 0.0;
    this.integerZoomStep = 0;
    // buffer: how many pixels is the texture larger than the canvas on each dimension?
    // --> two dimensional array with buffer[planeID][dimension], dimension: x->0, y->1
    this.buffer = {
      [OrthoViews.PLANE_XY]: [0, 0],
      [OrthoViews.PLANE_XZ]: [0, 0],
      [OrthoViews.PLANE_YZ]: [0, 0],
      [OrthoViews.TDView]: [0, 0],
    };
    this.position = [0, 0, 0];
    this.direction = [0, 0, 1];
    this.voxelPerPixel3DView = 100;
    this.spaceDirection = [1, 1, 1];
    this.quality = 0; // offset of integer zoom step to the best-quality zoom level

    this.updateStoredValues();

    // correct zoom values that are too high or too low
    this.user.set("zoom", Math.max(0.01, Math.min(this.user.get("zoom"), Math.floor(this.getMaxZoomStep()))));

    this.listenTo(this.model.get("datasetConfiguration"), "change:quality", (datasetModel, quality) => { this.setQuality(quality); });
    // TODO move zoom into tracing settings
    this.listenTo(this.user, "change:zoom", (userModel, zoomFactor) => { this.zoom(Math.log(zoomFactor) / Math.LN2); });

    // Fire changed event every time
    const trigger = this.trigger;
    this.trigger = (...args) => {
      trigger.apply(this, args);
      trigger.call(this, "changed");
    };
  }


  calculateMaxZoomStepDiff(): number {
    // Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff

    const zoomThreshold = Math.min(
      Flycam2dConstants.MAX_ZOOM_THRESHOLD,
      (constants.TEXTURE_WIDTH - Flycam2dConstants.MAX_TEXTURE_OFFSET) / this.viewportWidth,
    );
    return Math.log(zoomThreshold) / Math.LN2;
  }


  zoomByDelta(delta: number): void {
    this.zoom(this.zoomStep - (delta * constants.ZOOM_DIFF));
  }


  zoom(zoom: number): void {
    // Make sure the max. zoom Step will not be exceded
    if (zoom < this.zoomStepCount + this.maxZoomStepDiff) {
      this.setZoomStep(zoom);
    }
  }


  setQuality(value: number): void {
    // Set offset to the best-possible zoom step

    this.quality = value;
    this.updateStoredValues();
    this.update();
  }


  calculateIntegerZoomStep(): void {
    // round, because Model expects Integer
    this.integerZoomStep = Math.ceil((this.zoomStep - this.maxZoomStepDiff) + this.quality);
    this.integerZoomStep = Math.min(this.integerZoomStep, this.zoomStepCount);
    this.integerZoomStep = Math.max(this.integerZoomStep, 0);
  }


  getZoomStep(): number {
    return this.zoomStep;
  }


  setZoomStep(zoomStep: number): void {
    this.zoomStep = zoomStep;
    this.update();
    this.updateStoredValues();
    this.trigger("zoomStepChanged", zoomStep);
  }


  getMaxZoomStep(): number {
    const maxZoomStep = this.zoomStepCount - 1;
    return Math.pow(2, maxZoomStep + this.maxZoomStepDiff);
  }


  calculateBuffer(): void {
    let pixelNeeded;
    let scaleArray;
    for (const planeID of Object.keys(OrthoViews)) {
      scaleArray = Dimensions.transDim(scaleInfo.baseVoxelFactors, planeID);
      pixelNeeded = this.viewportWidth * this.getTextureScalingFactor();
      this.buffer[planeID] = [
        constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[0]),
        constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[1]),
      ];
    }
  }


  updateStoredValues(): void {
    this.calculateIntegerZoomStep();
    this.calculateBuffer();
  }


  getIntegerZoomStep(): number {
    if (!this.integerZoomStep) {
      this.calculateIntegerZoomStep();
    }

    return this.integerZoomStep;
  }


  getTextureScalingFactor(): number {
    return Math.pow(2, this.zoomStep) / Math.pow(2, this.integerZoomStep);
  }


  getPlaneScalingFactor(): number {
    return Math.pow(2, this.zoomStep);
  }


  getDirection(): Vector3 {
    return this.direction;
  }


  setDirection(direction: Vector3): void {
    this.direction = direction;
    if (this.user.get("dynamicSpaceDirection")) {
      this.setSpaceDirection(direction);
    }
  }


  setSpaceDirection(direction: Vector3): void {
    [0, 1, 2].forEach((index) => {
      if (direction[index] <= 0) {
        this.spaceDirection[index] = -1;
      } else {
        this.spaceDirection[index] = 1;
      }
    });
  }


  getSpaceDirection(): Vector3 {
    return this.spaceDirection;
  }


  getRotation(planeID: OrthoViewType): Vector3 {
    switch (planeID) {
      case OrthoViews.PLANE_YZ: return [0, 270, 0];
      case OrthoViews.PLANE_XZ: return [90, 0, 0];
      default:
      case OrthoViews.PLANE_XY: return [0, 0, 0];
    }
  }


  move(p: Vector3, planeID: ?OrthoViewType): void {
    // move by whatever is stored in p

    // if planeID is given, use it to manipulate z
    if (planeID != null) {
      // change direction of the value connected to space, based on the last direction
      p[Dimensions.getIndices(planeID)[2]] *= this.spaceDirection[Dimensions.getIndices(planeID)[2]];
    }
    this.setPosition([this.position[0] + p[0], this.position[1] + p[1], this.position[2] + p[2]]);
  }


  movePlane(vector: Vector3, planeID: OrthoViewType, increaseSpeedWithZoom: boolean = true) {
    // vector of voxels in BaseVoxels
    vector = Dimensions.transDim(vector, planeID);
    const zoomFactor = increaseSpeedWithZoom ? Math.pow(2, this.zoomStep) : 1;
    const scaleFactor = scaleInfo.baseVoxelFactors;
    const delta = [vector[0] * zoomFactor * scaleFactor[0],
      vector[1] * zoomFactor * scaleFactor[1],
      vector[2] * zoomFactor * scaleFactor[2]];
    this.move(delta, planeID);
  }


  toString(): string {
    const { position } = this;
    return `(x, y, z) = (${position[0]}, ${position[1]}, ${position[2]})`;
  }


  getPosition(): Vector3 {
    return this.position;
  }


  getViewportBoundingBox(): BoundingBoxType {
    const position = this.getPosition();
    const offset = (this.getPlaneScalingFactor() * this.viewportWidth) / 2;
    const min = [0, 0, 0];
    const max = [0, 0, 0];

    for (let i = 0; i <= 2; i++) {
      min[i] = position[i] - (offset * scaleInfo.baseVoxelFactors[i]);
      max[i] = position[i] + (offset * scaleInfo.baseVoxelFactors[i]);
    }

    return { min, max };
  }


  getTexturePosition(planeID: OrthoViewType): Vector3 {
    const texturePosition = this.position.slice();    // copy that position
    // As the Model does not render textures for exact positions, the last 5 bits of
    // the X and Y coordinates for each texture have to be set to 0
    for (let i = 0; i <= 2; i++) {
      if (i !== Dimensions.getIndices(planeID)[2]) {
        texturePosition[i] &= -1 << (5 + this.integerZoomStep);
      }
    }

    return texturePosition;
  }


  setPositionSilent(position: Vector3): void {
    for (let i = 0; i <= 2; i++) {
      if (position[i] == null) {
        position[i] = this.position[i];
      }
    }

    this.position = position;
    this.update();
  }


  setPosition(position: Vector3): void {
    this.setPositionSilent(position);
    this.trigger("positionChanged", position);
  }


  needsUpdate(planeID: OrthoViewType): boolean {
    const area = this.getArea(planeID);
    // const ind = Dimensions.getIndices(planeID);
    const res = ((area[0] < 0) || (area[1] < 0) || (area[2] > constants.TEXTURE_WIDTH) || (area[3] > constants.TEXTURE_WIDTH) ||
    // (@position[ind[2]] != @getTexturePosition(planeID)[ind[2]]) or # TODO: always false
    (this.zoomStep - (this.integerZoomStep - 1)) < this.maxZoomStepDiff) ||
    (this.zoomStep - this.integerZoomStep > this.maxZoomStepDiff);
    return res;
  }


  getOffsets(planeID: OrthoViewType): Vector2 {
    // return the coordinate of the upper left corner of the viewport as texture-relative coordinate

    const ind = Dimensions.getIndices(planeID);
    return [(this.buffer[planeID][0] / 2) + ((this.position[ind[0]] - this.getTexturePosition(planeID)[ind[0]]) / Math.pow(2, this.integerZoomStep)),
      (this.buffer[planeID][1] / 2) + ((this.position[ind[1]] - this.getTexturePosition(planeID)[ind[1]]) / Math.pow(2, this.integerZoomStep))];
  }


  getArea(planeID: OrthoViewType): Vector4 {
    // returns [left, top, right, bottom] array

    // convert scale vector to array in order to be able to use getIndices()
    const scaleArray = Dimensions.transDim(scaleInfo.baseVoxelFactors, planeID);
    const offsets = this.getOffsets(planeID);
    const size = this.getTextureScalingFactor() * this.viewportWidth;
    // two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
    // [offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
    return [offsets[0], offsets[1], offsets[0] + (size * scaleArray[0]), offsets[1] + (size * scaleArray[1])];
  }


  getAreas(): OrthoViewMapType<Vector4> {
    return {
      [OrthoViews.PLANE_XY]: this.getArea(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_XZ]: this.getArea(OrthoViews.PLANE_XZ),
      [OrthoViews.PLANE_YZ]: this.getArea(OrthoViews.PLANE_YZ),
    };
  }


  update3DViewSize(cameraRight: number, cameraLeft: number): void {
    this.voxelPerPixel3DView = (cameraRight - cameraLeft) / constants.VIEWPORT_WIDTH / scaleInfo.baseVoxel;
  }


  getRayThreshold(planeID: OrthoViewType): number {
    // Voxel threshold used for ray tracing
    if (planeID !== OrthoViews.TDView) {
      return Flycam2dConstants.PIXEL_RAY_THRESHOLD * Math.pow(2, this.zoomStep);
    } else {
      return Flycam2dConstants.PIXEL_RAY_THRESHOLD * this.voxelPerPixel3DView;
    }
  }


  update(): void {
    app.vent.trigger("rerender");
  }
}

export default Flycam2d;
