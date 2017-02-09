/**
 * bucket_builder.js
 * @flow
 */

import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";

type BucketInfo = {
  position: Vector3;
  zoomStep: number;
  cubeSize: number;
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const BucketBuilder = {

  fromZoomedAddress([x, y, z, zoomStep]: Vector4, options: Object = {}): BucketInfo {
    let bucket = {
      position: [
        x << (zoomStep + BUCKET_SIZE_P),
        y << (zoomStep + BUCKET_SIZE_P),
        z << (zoomStep + BUCKET_SIZE_P),
      ],
      zoomStep,
      cubeSize: 1 << BUCKET_SIZE_P,
    };

    bucket = Object.assign(bucket, options);

    return bucket;
  },


  bucketToZoomedAddress(bucket: BucketInfo): Vector4 {
    const [x, y, z] = bucket.position;
    const { zoomStep } = bucket;
    return [
      x >> (zoomStep + BUCKET_SIZE_P),
      y >> (zoomStep + BUCKET_SIZE_P),
      z >> (zoomStep + BUCKET_SIZE_P),
      zoomStep,
    ];
  },

};


export default BucketBuilder;
