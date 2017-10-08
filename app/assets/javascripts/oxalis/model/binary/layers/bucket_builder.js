/**
 * bucket_builder.js
 * @flow
 */

import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import Store from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import type { BucketRequestOptions } from "oxalis/model/binary/layers/layer";

export type BucketInfo = {
  position: Vector3,
  zoomStep: number,
  cubeSize: number,

  // From BucketRequestOptions
  fourBit: ?boolean,
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
class BucketBuilder {
  fromZoomedAddress([x, y, z, zoomStep]: Vector4, options: ?BucketRequestOptions): BucketInfo {
    const bucket = {
      position: [
        x << (zoomStep + BUCKET_SIZE_P),
        y << (zoomStep + BUCKET_SIZE_P),
        z << (zoomStep + BUCKET_SIZE_P),
      ],
      zoomStep,
      cubeSize: 1 << BUCKET_SIZE_P,
      fourBit: undefined,
    };

    if (options != null) {
      return Object.assign(bucket, options);
    } else {
      return Object.assign(bucket, { fourBit: Store.getState().datasetConfiguration.fourBit });
    }
  }

  bucketToZoomedAddress(bucket: BucketInfo): Vector4 {
    const [x, y, z] = bucket.position;
    const { zoomStep } = bucket;
    return [
      x >> (zoomStep + BUCKET_SIZE_P),
      y >> (zoomStep + BUCKET_SIZE_P),
      z >> (zoomStep + BUCKET_SIZE_P),
      zoomStep,
    ];
  }
}

export default new BucketBuilder();
