// @flow

import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";

export default {
  globalPositionToBucketPosition(
    [x, y, z]: Vector3,
    resolutions: Array<Vector3>,
    resolutionIndex: number,
  ): Vector4 {
    const resolution = resolutions[resolutionIndex];
    return [
      Math.floor(x / (constants.BUCKET_WIDTH * resolution[0])),
      Math.floor(y / (constants.BUCKET_WIDTH * resolution[1])),
      Math.floor(z / (constants.BUCKET_WIDTH * resolution[2])),
      resolutionIndex,
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
};
