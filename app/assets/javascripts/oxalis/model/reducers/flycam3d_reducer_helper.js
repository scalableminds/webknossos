// @flow
import type { Vector3 } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4 } from "libs/mjs";
import type { Flycam3DType } from "oxalis/store";
import * as THREE from "three";

export function getUp(flycam3d: Flycam3DType): Vector3 {
  const matrix = flycam3d.currentMatrix;
  return [matrix[4], matrix[5], matrix[6]];
}

export function getLeft(flycam3d: Flycam3DType): Vector3 {
  const matrix = flycam3d.currentMatrix;
  return [matrix[0], matrix[1], matrix[2]];
}

export function getPosition(flycam3d: Flycam3DType): Vector3 {
  const matrix = flycam3d.currentMatrix;
  return [matrix[12], matrix[13], matrix[14]];
}

export function getRotation(flycam3d: Flycam3DType): Vector3 {
  const object = new THREE.Object3D();
  const matrix = (new THREE.Matrix4()).fromArray(flycam3d.currentMatrix).transpose();
  object.applyMatrix(matrix);

  // Fix JS modulo bug
  // http://javascript.about.com/od/problemsolving/a/modulobug.htm
  const mod = (x, n) => ((x % n) + n) % n;

  const rotation: Vector3 = [
    object.rotation.x,
    object.rotation.y,
    object.rotation.z - Math.PI,
  ];
  return [
    mod((180 / Math.PI) * rotation[0], 360),
    mod((180 / Math.PI) * rotation[1], 360),
    mod((180 / Math.PI) * rotation[2], 360),
  ];
}

export function getZoomedMatrix(flycam3d: Flycam3DType): Matrix4x4 {
  return M4x4.scale1(flycam3d.zoomStep, flycam3d.currentMatrix);
}
