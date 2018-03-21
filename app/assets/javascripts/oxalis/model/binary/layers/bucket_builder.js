/**
 * bucket_builder.js
 * @flow
 */

import Store from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import type { BucketRequestOptions } from "oxalis/model/binary/layers/layer";
import PositionConverter from "oxalis/model/helpers/position_converter";

export type BucketInfo = {
  position: Vector3,
  zoomStep: number,
  cubeSize: number,

  // From BucketRequestOptions
  fourBit: ?boolean,
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
export default {
  fromZoomedAddress(
    zoomedAddress: Vector4,
    resolutions: Array<Vector3>,
    options: ?BucketRequestOptions,
  ): BucketInfo {
    const position = PositionConverter.bucketPositionToGlobalAddress(zoomedAddress, resolutions);
    const zoomStep = zoomedAddress[3];

    const bucket = {
      position,
      zoomStep,
      cubeSize: constants.BUCKET_WIDTH,
      fourBit: undefined,
    };

    if (options != null) {
      return Object.assign(bucket, options);
    } else {
      return Object.assign(bucket, { fourBit: Store.getState().datasetConfiguration.fourBit });
    }
  },
};
