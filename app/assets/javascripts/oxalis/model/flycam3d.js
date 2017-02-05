/**
 * flycam3d.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";
import { M4x4 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";

const updateMacro = function (_this) {
  _this.trigger("changed", _this.currentMatrix, _this.zoomStep);
  _this.hasChanged = true;
};


const transformationWithDistanceMacro = function (_this, transformationFn, transformationArg1, transformationArg2) {
  const { currentMatrix } = _this;
  M4x4.translate(_this.distanceVecNegative, currentMatrix, currentMatrix);
  transformationFn.call(_this, transformationArg1, transformationArg2);
  M4x4.translate(_this.distanceVecPositive, currentMatrix, currentMatrix);
};

const ZOOM_STEP_INTERVAL = 1.1;
const ZOOM_STEP_MIN = 0.5;
const ZOOM_STEP_MAX = 5;

class Flycam3d {
  zoomStep = 1.3;
  hasChanged = true;
  scale: Vector3;
  currentMatrix: Array<number>;
  distance: number;
  distanceVecNegative: Vector3;
  distanceVecPositive: Vector3;

  constructor(distance, scale) {
    this.distance = distance;
    _.extend(this, Backbone.Events);

    this.scale = this.calculateScaleValues(scale);

    this.reset();
    this.calculateDistanceVectors(this.zoomStep);
  }


  calculateDistanceVectors(zoomStep = 1) {
    this.distanceVecNegative = [0, 0, -zoomStep * this.distance];
    this.distanceVecPositive = [0, 0, zoomStep * this.distance];
  }


  calculateScaleValues(scale): Vector3 {
    scale = [1 / scale[0], 1 / scale[1], 1 / scale[2]];
    const maxScale = Math.max(scale[0], scale[1], scale[2]);
    const multi = 1 / maxScale;
    scale = [multi * scale[0], multi * scale[1], multi * scale[2]];
    return scale;
  }


  reset(resetPosition = true) {
    let position;
    const { scale } = this;
    if (this.currentMatrix != null) {
      position = this.currentMatrix.slice(12, 15);
    }

    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    M4x4.scale(scale, m, m);
    this.currentMatrix = m;

    if ((position != null) && !resetPosition) {
      this.setPosition(position);
    }

    // Apply 180° Rotation to keep it consistent with plane view
    this.roll(Math.PI);

    return updateMacro(this);
  }


  update() {
    return updateMacro(this);
  }


  flush() {
    if (this.hasChanged) {
      this.hasChanged = false;
      return true;
    }
    return false;
  }


  zoomIn() {
    this.zoomStep = Math.max(this.zoomStep / ZOOM_STEP_INTERVAL, ZOOM_STEP_MIN);
    this.calculateDistanceVectors(this.zoomStep);
    return updateMacro(this);
  }


  zoomOut() {
    this.zoomStep = Math.min(this.zoomStep * ZOOM_STEP_INTERVAL, ZOOM_STEP_MAX);
    this.calculateDistanceVectors(this.zoomStep);
    return updateMacro(this);
  }


  getZoomStep() {
    return this.zoomStep;
  }


  setZoomStep(zoomStep) {
    this.zoomStep = Math.min(ZOOM_STEP_MAX, Math.max(ZOOM_STEP_MIN, zoomStep));
  }


  getMatrix() {
    return M4x4.clone(this.currentMatrix);
  }


  getZoomedMatrix() {
    const matrix = this.getMatrix();
    return M4x4.scale1(this.zoomStep, matrix, matrix);
  }


  setMatrix(matrix) {
    this.currentMatrix = M4x4.clone(matrix);
    return updateMacro(this);
  }


  move(vector) {
    M4x4.translate(vector, this.currentMatrix, this.currentMatrix);
    return updateMacro(this);
  }


  yaw(angle, regardDistance = false) {
    if (regardDistance) {
      transformationWithDistanceMacro(this, this.yawSilent, angle);
    } else {
      this.yawSilent(angle);
    }
    return updateMacro(this);
  }


  yawSilent(angle) {
    return this.rotateOnAxisSilent(angle, [0, 1, 0]);
  }


  roll(angle, regardDistance = false) {
    if (regardDistance) {
      transformationWithDistanceMacro(this, this.rollSilent, angle);
    } else {
      this.rollSilent(angle);
    }
    return updateMacro(this);
  }


  rollSilent(angle) {
    return this.rotateOnAxisSilent(angle, [0, 0, 1]);
  }


  pitch(angle, regardDistance = false) {
    if (regardDistance) {
      transformationWithDistanceMacro(this, this.pitchSilent, angle);
    } else {
      this.pitchSilent(angle);
    }
    return updateMacro(this);
  }


  pitchSilent(angle) {
    return this.rotateOnAxisSilent(angle, [1, 0, 0]);
  }


  rotateOnAxis(angle, axis) {
    this.rotateOnAxisSilent(angle, axis);
    return updateMacro(this);
  }


  rotateOnAxisSilent(angle, axis) {
    return M4x4.rotate(angle, axis, this.currentMatrix, this.currentMatrix);
  }


  rotateOnAxisDistance(angle, axis) {
    transformationWithDistanceMacro(this, this.rotateOnAxisSilent, angle, axis);
    return updateMacro(this);
  }


  toString() {
    const matrix = this.currentMatrix;
    return `[${matrix[0]}, ${matrix[1]}, ${matrix[2]}, ${matrix[3]}, ${
      matrix[4]}, ${matrix[5]}, ${matrix[6]}, ${matrix[7]}, ${
      matrix[8]}, ${matrix[9]}, ${matrix[10]}, ${matrix[11]}, ${
      matrix[12]}, ${matrix[13]}, ${matrix[14]}, ${matrix[15]}]`;
  }


  getPosition() {
    const matrix = this.currentMatrix;
    return [matrix[12], matrix[13], matrix[14]];
  }


  getRotation() {
    const object = new THREE.Object3D();
    const matrix = (new THREE.Matrix4()).fromArray(this.currentMatrix).transpose();
    object.applyMatrix(matrix);

    // Fix JS modulo bug
    // http://javascript.about.com/od/problemsolving/a/modulobug.htm
    const mod = (x, n) => ((x % n) + n) % n;

    return _.map([
      object.rotation.x,
      object.rotation.y,
      object.rotation.z - Math.PI,
    ], e => mod((180 / Math.PI) * e, 360));
  }


  setPositionSilent(p) {
    const matrix = this.currentMatrix;
    matrix[12] = p[0];
    matrix[13] = p[1];
    matrix[14] = p[2];
  }


  setPosition(p) {
    this.setPositionSilent(p);
    return updateMacro(this);
  }


  setRotation([x, y, z]) {
    this.reset(false);
    this.roll((-z * Math.PI) / 180);
    this.yaw((-y * Math.PI) / 180);
    return this.pitch((-x * Math.PI) / 180);
  }


  getCurrentUpVector() {
    const currentRotation = new THREE.Matrix4();
    currentRotation.extractRotation(new THREE.Matrix4(...this.currentMatrix));
    const up = new THREE.Vector3(0, 1, 0);
    up.applyMatrix4(currentRotation);

    return up;
  }


  convertToJsArray(floatXArray) {
    return Array.prototype.slice.call(floatXArray);
  }


  getUp() {
    const matrix = this.currentMatrix;
    return [matrix[4], matrix[5], matrix[6]];
  }


  getLeft() {
    const matrix = this.currentMatrix;
    return [matrix[0], matrix[1], matrix[2]];
  }
}

export default Flycam3d;
