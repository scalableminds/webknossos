import { V3 } from "libs/mjs";
import { mod } from "libs/utils";
import { Euler, Matrix4 } from "three";
import type { Vector3 } from "viewer/constants";

// Pre definitions to avoid redundant object creation.
const matrix = new Matrix4();
const euler = new Euler();
const invertedEulerMatrix = new Matrix4();

// This function performs the same operations as done in the flycam reducer for the setRotation action.
// When rotation calculation are needed in the flycam matrix space, this function can be used to
// first convert the angle into the quirky way the flycam matrix does rotations.
// After the rotation calculation is done, the companion function reducerInternalMatrixToEulerAngle
// should be used to transform the result back.
// For some more info look at
// https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c6380cf8302fb8f6749ae1d.
export function eulerAngleToReducerInternalMatrix(angleInRadian: Vector3): THREE.Matrix4 {
  // Perform same operations as the flycam reducer does. First default 180° around z.
  let matrixLikeInReducer = matrix.makeRotationZ(Math.PI);
  // Invert angle and interpret as ZYX order
  const invertedEuler = euler.set(...V3.scale(angleInRadian, -1), "ZYX");
  // Apply inverted ZYX euler.
  matrixLikeInReducer = matrixLikeInReducer.multiply(
    invertedEulerMatrix.makeRotationFromEuler(invertedEuler),
  );
  return matrixLikeInReducer;
}

// Pre definitions to avoid redundant object creation.
const rotationFromMatrix = new Euler();

// The companion function of eulerAngleToReducerInternalMatrix converting a rotation back from the flycam reducer space.
// The output is in radian and should be interpreted as if in ZYX order.
// Note: The matrix must be a rotation only matrix.
export function reducerInternalMatrixToEulerAngle(matrixInReducerFormat: THREE.Matrix4): Vector3 {
  const localRotationFromMatrix = rotationFromMatrix.setFromRotationMatrix(
    matrixInReducerFormat.clone().transpose(),
    "XYZ",
  );
  return [
    mod(localRotationFromMatrix.x, 2 * Math.PI),
    mod(localRotationFromMatrix.y, 2 * Math.PI),
    mod(localRotationFromMatrix.z - Math.PI, 2 * Math.PI),
  ];
}
