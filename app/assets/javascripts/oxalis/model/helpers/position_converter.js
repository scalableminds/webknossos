// @flow

import _ from "lodash";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";

export default {
  globalPositionToBucketPosition(
    [x, y, z]: Vector3,
    resolutions: Array<Vector3>,
    resolutionIndex: number,
  ): Vector4 {
    const resolution =
      resolutionIndex < resolutions.length
        ? resolutions[resolutionIndex]
        : this.upsampleResolution(resolutions, resolutionIndex);

    return [
      Math.floor(x / (constants.BUCKET_WIDTH * resolution[0])),
      Math.floor(y / (constants.BUCKET_WIDTH * resolution[1])),
      Math.floor(z / (constants.BUCKET_WIDTH * resolution[2])),
      resolutionIndex,
    ];
  },

  upsampleResolution(resolutions: Array<Vector3>, resolutionIndex: number): Vector3 {
    const lastResolutionIndex = resolutions.length - 1;
    const lastResolution = resolutions[lastResolutionIndex];
    const multiplier = Math.pow(2, resolutionIndex - lastResolutionIndex);

    return [
      lastResolution[0] * multiplier,
      lastResolution[1] * multiplier,
      lastResolution[2] * multiplier,
    ];
  },

  bucketPositionToGlobalAddress(
    [x, y, z, resolutionIndex]: Vector4,
    resolutions: Array<Vector3>,
  ): Vector3 {
    const resolution = resolutions[resolutionIndex];
    return [
      x * constants.BUCKET_WIDTH * resolution[0],
      y * constants.BUCKET_WIDTH * resolution[1],
      z * constants.BUCKET_WIDTH * resolution[2],
    ];
  },

  zoomedAddressToAnotherZoomStep(
    [x, y, z, resolutionIndex]: Vector4,
    resolutions: Array<Vector3>,
    targetResolutionIndex: number,
  ): Vector4 {
    const currentResolution = resolutions[resolutionIndex];
    const targetResolution = resolutions[targetResolutionIndex];

    return [
      Math.floor(x * (currentResolution[0] / targetResolution[0])),
      Math.floor(y * (currentResolution[1] / targetResolution[1])),
      Math.floor(z * (currentResolution[2] / targetResolution[2])),
      targetResolutionIndex,
    ];
  },
};
