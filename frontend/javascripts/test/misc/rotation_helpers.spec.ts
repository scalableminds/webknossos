import { describe, it, expect } from "vitest";
import {
  eulerAngleToReducerInternalMatrix,
  reducerInternalMatrixToEulerAngle,
} from "viewer/model/helpers/rotation_helpers";
import type { Vector3 } from "viewer/constants";
import * as THREE from "three";
import { map3 } from "libs/utils";
import testRotations from "test/fixtures/test_rotations";

describe("Rotation Helper Functions", () => {
  it("should result in an equal rotation after transforming into flycam reducer rotation space and back.", () => {
    for (const testRotation of testRotations) {
      const inputRotationInRadian = map3(THREE.MathUtils.degToRad, testRotation);
      const rotationMatrix = eulerAngleToReducerInternalMatrix(inputRotationInRadian);
      const resultingAngle = reducerInternalMatrixToEulerAngle(rotationMatrix);
      const inputQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...inputRotationInRadian),
      );
      const outputQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...resultingAngle),
      );
      expect(
        inputQuaternion.angleTo(outputQuaternion),
        `Angle ${testRotation} is not converted properly`,
      ).toBeLessThan(0.000001);
    }
  });
  // This tests goal is to test and document that the output after converting back from the 'flycam rotation reducer space' the result needs to be interpreted as a XYZ Euler angle.
  it("should *not* result in an equal rotation after transforming into flycam reducer rotation space and back if interpreted in wrong euler order.", () => {
    const testRotation = [30, 90, 40] as Vector3;
    const inputRotationInRadian = map3(THREE.MathUtils.degToRad, testRotation);
    const rotationMatrix = eulerAngleToReducerInternalMatrix(inputRotationInRadian);
    const resultingAngle = reducerInternalMatrixToEulerAngle(rotationMatrix);
    const inputQuaternionZYX = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...inputRotationInRadian, "ZYX"),
    );
    const outputQuaternionZYX = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...resultingAngle, "ZYX"),
    );
    expect(
      inputQuaternionZYX.angleTo(outputQuaternionZYX),
      `Angle ${testRotation} is equal although interpreted as 'ZYX' euler order. `,
    ).toBeGreaterThan(0.001);
    const inputQuaternionYZX = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...inputRotationInRadian, "YZX"),
    );
    const outputQuaternionYZX = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...resultingAngle, "YZX"),
    );
    expect(
      inputQuaternionYZX.angleTo(outputQuaternionYZX),
      `Angle ${testRotation} is equal although interpreted as 'YZX' euler order. `,
    ).toBeGreaterThan(0.001);
    const inputQuaternionXYZ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...inputRotationInRadian, "XYZ"),
    );
    const outputQuaternionXYZ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...resultingAngle, "XYZ"),
    );
    expect(
      inputQuaternionXYZ.angleTo(outputQuaternionXYZ),
      `Angle ${testRotation} is not equal although interpreted as 'XYZ' euler order should be correct. `,
    ).toBeLessThan(0.00001);
  });
});
