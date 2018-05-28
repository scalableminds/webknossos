/**
 * bucket_builder.js
 * @flow
 */

import Store from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";

export type BucketInfo = {
  position: Vector3,
  zoomStep: number,
  cubeSize: number,
  fourBit: boolean,
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
export default {
  fromZoomedAddress(zoomedAddress: Vector4, resolutions: Array<Vector3>): BucketInfo {
    const position = bucketPositionToGlobalAddress(zoomedAddress, resolutions);
    const zoomStep = zoomedAddress[3];

    return {
      position,
      zoomStep,
      cubeSize: constants.BUCKET_WIDTH,
      fourBit: Store.getState().datasetConfiguration.fourBit,
    };
  },
};
