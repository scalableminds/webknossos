/**
 * flycam3d.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";
import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";

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

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;

  constructor(distance: number, scale: Vector3) {
    this.distance = distance;
    _.extend(this, Backbone.Events);

    this.scale = this.calculateScaleValues(scale);

    this.reset();
    this.calculateDistanceVectors(this.zoomStep);
  }

  transformationWithDistance(transformationCallback: () => void) {
    const { currentMatrix } = this;
    M4x4.translate(this.distanceVecNegative, currentMatrix, currentMatrix);
    transformationCallback();
    M4x4.translate(this.distanceVecPositive, currentMatrix, currentMatrix);
  }


  calculateDistanceVectors(zoomStep: number = 1): void {
    this.distanceVecNegative = [0, 0, -zoomStep * this.distance];
    this.distanceVecPositive = [0, 0, zoomStep * this.distance];
  }


  calculateScaleValues(scale: Vector3): Vector3 {
    scale = [1 / scale[0], 1 / scale[1], 1 / scale[2]];
    const maxScale = Math.max(scale[0], scale[1], scale[2]);
    const multi = 1 / maxScale;
    scale = [multi * scale[0], multi * scale[1], multi * scale[2]];
    return scale;
  }


  reset(resetPosition: boolean = true): void {
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

    this.update();
  }


  update(): void {
    this.trigger("changed", this.currentMatrix, this.zoomStep);
    this.hasChanged = true;
  }


  flush(): boolean {
    if (this.hasChanged) {
      this.hasChanged = false;
      return true;
    }
    return false;
  }


  zoomIn(): void {
    this.zoomStep = Math.max(this.zoomStep / ZOOM_STEP_INTERVAL, ZOOM_STEP_MIN);
    this.calculateDistanceVectors(this.zoomStep);
    this.update();
  }


  zoomOut(): void {
    this.zoomStep = Math.min(this.zoomStep * ZOOM_STEP_INTERVAL, ZOOM_STEP_MAX);
    this.calculateDistanceVectors(this.zoomStep);
    this.update();
  }


  getZoomStep(): number {
    return this.zoomStep;
  }


  setZoomStep(zoomStep: number): void {
    this.zoomStep = Math.min(ZOOM_STEP_MAX, Math.max(ZOOM_STEP_MIN, zoomStep));
  }


  getMatrix(): Matrix4x4 {
    return M4x4.clone(this.currentMatrix);
  }


  getZoomedMatrix(): Matrix4x4 {
    const matrix = this.getMatrix();
    return M4x4.scale1(this.zoomStep, matrix, matrix);
  }


  setMatrix(matrix: Matrix4x4): void {
    this.currentMatrix = M4x4.clone(matrix);
    this.update();
  }


  move(vector: Vector3): void {
    M4x4.translate(vector, this.currentMatrix, this.currentMatrix);
    this.update();
  }


  yaw(angle: number, regardDistance: boolean = false): void {
    if (regardDistance) {
      this.transformationWithDistance(() => { this.yawSilent(angle); });
    } else {
      this.yawSilent(angle);
    }
    this.update();
  }


  yawSilent(angle: number): void {
    this.rotateOnAxisSilent(angle, [0, 1, 0]);
  }


  roll(angle: number, regardDistance: boolean = false): void {
    if (regardDistance) {
      this.transformationWithDistance(() => { this.rollSilent(angle); });
    } else {
      this.rollSilent(angle);
    }
    this.update();
  }


  rollSilent(angle: number): void {
    this.rotateOnAxisSilent(angle, [0, 0, 1]);
  }


  pitch(angle: number, regardDistance: boolean = false): void {
    if (regardDistance) {
      this.transformationWithDistance(() => { this.pitchSilent(angle); });
    } else {
      this.pitchSilent(angle);
    }
    this.update();
  }


  pitchSilent(angle: number): void {
    this.rotateOnAxisSilent(angle, [1, 0, 0]);
  }


  rotateOnAxis(angle: number, axis: Vector3): void {
    this.rotateOnAxisSilent(angle, axis);
    this.update();
  }


  rotateOnAxisSilent(angle: number, axis: Vector3): void {
    M4x4.rotate(angle, axis, this.currentMatrix, this.currentMatrix);
  }


  rotateOnAxisDistance(angle: number, axis: Vector3): void {
    this.transformationWithDistance(() => { this.rotateOnAxisSilent(angle, axis); });
    this.update();
  }


  toString(): string {
    const matrix = this.currentMatrix;
    return `[${matrix[0]}, ${matrix[1]}, ${matrix[2]}, ${matrix[3]}, ${
      matrix[4]}, ${matrix[5]}, ${matrix[6]}, ${matrix[7]}, ${
      matrix[8]}, ${matrix[9]}, ${matrix[10]}, ${matrix[11]}, ${
      matrix[12]}, ${matrix[13]}, ${matrix[14]}, ${matrix[15]}]`;
  }


  getPosition(): Vector3 {
    const matrix = this.currentMatrix;
    return [matrix[12], matrix[13], matrix[14]];
  }


  getRotation(): Vector3 {
    const object = new THREE.Object3D();
    const matrix = (new THREE.Matrix4()).fromArray(this.currentMatrix).transpose();
    object.applyMatrix(matrix);

    // Fix JS modulo bug
    // http://javascript.about.com/od/problemsolving/a/modulobug.htm
    const mod = (x, n) => ((x % n) + n) % n;

    return [
      object.rotation.x,
      object.rotation.y,
      object.rotation.z - Math.PI,
    ].map(e => mod((180 / Math.PI) * e, 360));
  }


  setPositionSilent(p: Vector3): void {
    const matrix = this.currentMatrix;
    matrix[12] = p[0];
    matrix[13] = p[1];
    matrix[14] = p[2];
  }


  setPosition(p: Vector3): void {
    this.setPositionSilent(p);
    this.update();
  }


  setRotation([x, y, z]: Vector3): void {
    this.reset(false);
    this.roll((-z * Math.PI) / 180);
    this.yaw((-y * Math.PI) / 180);
    this.pitch((-x * Math.PI) / 180);
  }


  getCurrentUpVector(): Vector3 {
    const currentRotation = new THREE.Matrix4();
    currentRotation.extractRotation(new THREE.Matrix4(...this.currentMatrix));
    const up = new THREE.Vector3(0, 1, 0);
    up.applyMatrix4(currentRotation);

    return up;
  }


  convertToJsArray(floatXArray: Float32Array): number[] {
    return Array.prototype.slice.call(floatXArray);
  }


  getUp(): Vector3 {
    const matrix = this.currentMatrix;
    return [matrix[4], matrix[5], matrix[6]];
  }


  getLeft(): Vector3 {
    const matrix = this.currentMatrix;
    return [matrix[0], matrix[1], matrix[2]];
  }
}

export default Flycam3d;
