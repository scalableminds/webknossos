/**
 * bucket_builder.js
 * @flow weak
 */

import _ from "lodash";
import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const BucketBuilder = {

  fromZoomedAddress([x, y, z, zoomStep], options = {}) {
    let bucket = {
      position: [
        x << (zoomStep + BUCKET_SIZE_P),
        y << (zoomStep + BUCKET_SIZE_P),
        z << (zoomStep + BUCKET_SIZE_P),
      ],
      zoomStep,
      cubeSize: 1 << BUCKET_SIZE_P,
    };

    bucket = _.extend(bucket, options);

    return bucket;
  },


  bucketToZoomedAddress(bucket) {
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
