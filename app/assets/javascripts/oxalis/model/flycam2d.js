import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import Dimensions from "./dimensions";
import constants from "../constants";


// maximum difference between requested coordinate and actual texture position
const MAX_TEXTURE_OFFSET = 31;
const MAX_ZOOM_THRESHOLD = 2;
const PIXEL_RAY_THRESHOLD = 10;


class Flycam2d {

  constructor(viewportWidth, zoomStepCount, model) {
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
    this.buffer = [[0, 0], [0, 0], [0, 0]];
    this.position = [0, 0, 0];
    this.direction = [0, 0, 1];
    this.voxelPerPixel3DView = 100;
    this.spaceDirection = [1, 1, 1];
    this.quality = 0; // offset of integer zoom step to the best-quality zoom level

    this.updateStoredValues();

    // correct zoom values that are too high or too low
    this.user.set("zoom", Math.max(0.01, Math.min(this.user.get("zoom"), Math.floor(this.getMaxZoomStep()))));

    this.listenTo(this.model.get("datasetConfiguration"), "change:quality", function (datasetModel, quality) { return this.setQuality(quality); });
    // TODO move zoom into tracing settings
    this.listenTo(this.user, "change:zoom", function (userModel, zoomFactor) { return this.zoom(Math.log(zoomFactor) / Math.LN2); });

    // Fire changed event every time
    const trigger = this.trigger;
    this.trigger = (...args) => {
      trigger.apply(this, args);
      trigger.call(this, "changed");
    };
  }


  calculateMaxZoomStepDiff() {
    // Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff

    const zoomThreshold = Math.min(
      MAX_ZOOM_THRESHOLD,
      (constants.TEXTURE_WIDTH - MAX_TEXTURE_OFFSET) / this.viewportWidth,
    );
    return Math.log(zoomThreshold) / Math.LN2;
  }


  zoomByDelta(delta) {
    this.zoom(this.zoomStep - (delta * constants.ZOOM_DIFF));
  }


  zoom(zoom) {
    // Make sure the max. zoom Step will not be exceded
    if (zoom < this.zoomStepCount + this.maxZoomStepDiff) {
      this.setZoomStep(zoom);
    }
  }


  setQuality(value) {
    // Set offset to the best-possible zoom step

    this.quality = value;
    this.updateStoredValues();
    this.update();
  }


  calculateIntegerZoomStep() {
    // round, because Model expects Integer
    this.integerZoomStep = Math.ceil((this.zoomStep - this.maxZoomStepDiff) + this.quality);
    this.integerZoomStep = Math.min(this.integerZoomStep, this.zoomStepCount);
    this.integerZoomStep = Math.max(this.integerZoomStep, 0);
  }


  getZoomStep() {
    return this.zoomStep;
  }


  setZoomStep(zoomStep) {
    this.zoomStep = zoomStep;
    this.update();
    this.updateStoredValues();
    this.trigger("zoomStepChanged", zoomStep);
  }


  getMaxZoomStep() {
    const maxZoomStep = this.zoomStepCount - 1;
    return Math.pow(2, maxZoomStep + this.maxZoomStepDiff);
  }


  calculateBuffer() {
    let pixelNeeded;
    let scaleArray;
    return [0, 1, 2].forEach((planeID) => {
      scaleArray = Dimensions.transDim(app.scaleInfo.baseVoxelFactors, planeID);
      pixelNeeded = this.viewportWidth * this.getTextureScalingFactor();
      this.buffer[planeID] = [constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[0]),
        constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[1])];
    });
  }


  updateStoredValues() {
    this.calculateIntegerZoomStep();
    this.calculateBuffer();
  }


  getIntegerZoomStep() {
    if (!this.integerZoomStep) {
      this.calculateIntegerZoomStep();
    }

    return this.integerZoomStep;
  }


  getTextureScalingFactor() {
    return Math.pow(2, this.zoomStep) / Math.pow(2, this.integerZoomStep);
  }


  getPlaneScalingFactor() {
    return Math.pow(2, this.zoomStep);
  }


  getDirection() {
    return this.direction;
  }


  setDirection(direction) {
    this.direction = direction;
    if (this.user.get("dynamicSpaceDirection")) {
      this.setSpaceDirection(direction);
    }
  }


  setSpaceDirection(direction) {
    [0, 1, 2].forEach((index) => {
      if (direction[index] <= 0) {
        this.spaceDirection[index] = -1;
      } else {
        this.spaceDirection[index] = 1;
      }
    });
  }


  getSpaceDirection() {
    return this.spaceDirection;
  }


  getRotation(planeID) {
    switch (planeID) {
      case constants.PLANE_YZ: return [0, 270, 0];
      case constants.PLANE_XZ: return [90, 0, 0];
      default:
      case constants.PLANE_XY: return [0, 0, 0];
    }
  }


  move(p, planeID) {
    // move by whatever is stored in p

    // if planeID is given, use it to manipulate z
    if (planeID != null) {
      // change direction of the value connected to space, based on the last direction
      p[Dimensions.getIndices(planeID)[2]] *= this.spaceDirection[Dimensions.getIndices(planeID)[2]];
    }
    this.setPosition([this.position[0] + p[0], this.position[1] + p[1], this.position[2] + p[2]]);
  }


  movePlane(vector, planeID, increaseSpeedWithZoom) {
    // vector of voxels in BaseVoxels

    if (increaseSpeedWithZoom == null) { increaseSpeedWithZoom = true; }
    vector = Dimensions.transDim(vector, planeID);
    const zoomFactor = increaseSpeedWithZoom ? Math.pow(2, this.zoomStep) : 1;
    const scaleFactor = app.scaleInfo.baseVoxelFactors;
    const delta = [vector[0] * zoomFactor * scaleFactor[0],
      vector[1] * zoomFactor * scaleFactor[1],
      vector[2] * zoomFactor * scaleFactor[2]];
    this.move(delta, planeID);
  }


  toString() {
    const { position } = this;
    return `(x, y, z) = (${position[0]}, ${position[1]}, ${position[2]})`;
  }


  getPosition() {
    return this.position;
  }


  getViewportBoundingBox() {
    const position = this.getPosition();
    const offset = (this.getPlaneScalingFactor() * this.viewportWidth) / 2;
    const min = [];
    const max = [];

    for (let i = 0; i <= 2; i++) {
      min.push(position[i] - (offset * app.scaleInfo.baseVoxelFactors[i]));
      max.push(position[i] + (offset * app.scaleInfo.baseVoxelFactors[i]));
    }

    return { min, max };
  }


  getTexturePosition(planeID) {
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


  setPositionSilent(position) {
    for (let i = 0; i <= 2; i++) {
      if (position[i] == null) {
        position[i] = this.position[i];
      }
    }

    this.position = position;
    this.update();
  }


  setPosition(position) {
    this.setPositionSilent(position);
    this.trigger("positionChanged", position);
  }


  needsUpdate(planeID) {
    const area = this.getArea(planeID);
    // const ind = Dimensions.getIndices(planeID);
    const res = ((area[0] < 0) || (area[1] < 0) || (area[2] > constants.TEXTURE_WIDTH) || (area[3] > constants.TEXTURE_WIDTH) ||
    // (@position[ind[2]] != @getTexturePosition(planeID)[ind[2]]) or # TODO: always false
    (this.zoomStep - (this.integerZoomStep - 1)) < this.maxZoomStepDiff) ||
    (this.zoomStep - this.integerZoomStep > this.maxZoomStepDiff);
    return res;
  }


  getOffsets(planeID) {
    // return the coordinate of the upper left corner of the viewport as texture-relative coordinate

    const ind = Dimensions.getIndices(planeID);
    return [(this.buffer[planeID][0] / 2) + ((this.position[ind[0]] - this.getTexturePosition(planeID)[ind[0]]) / Math.pow(2, this.integerZoomStep)),
      (this.buffer[planeID][1] / 2) + ((this.position[ind[1]] - this.getTexturePosition(planeID)[ind[1]]) / Math.pow(2, this.integerZoomStep))];
  }


  getArea(planeID) {
    // returns [left, top, right, bottom] array

    // convert scale vector to array in order to be able to use getIndices()
    const scaleArray = Dimensions.transDim(app.scaleInfo.baseVoxelFactors, planeID);
    const offsets = this.getOffsets(planeID);
    const size = this.getTextureScalingFactor() * this.viewportWidth;
    // two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
    // [offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
    return [offsets[0], offsets[1], offsets[0] + (size * scaleArray[0]), offsets[1] + (size * scaleArray[1])];
  }


  getAreas() {
    const result = [];
    for (let i = 0; i <= 2; i++) {
      result.push(this.getArea(i));
    }
    return result;
  }


  update3DViewSize(cameraRight, cameraLeft) {
    this.voxelPerPixel3DView = (cameraRight - cameraLeft) / constants.VIEWPORT_WIDTH / app.scaleInfo.baseVoxel;
  }


  getRayThreshold(planeID) {
    // Voxel threshold used for ray tracing
    if (planeID < 3) {
      return PIXEL_RAY_THRESHOLD * Math.pow(2, this.zoomStep);
    } else {
      return PIXEL_RAY_THRESHOLD * this.voxelPerPixel3DView;
    }
  }


  update() {
    app.vent.trigger("rerender");
  }
}

export default Flycam2d;
