import Cube from "../cube";
import _ from "lodash";

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const BucketBuilder = {

  fromZoomedAddress([x, y, z, zoomStep], options = {}) {
    let bucket = {
      position: [
        x << (zoomStep + Cube.prototype.BUCKET_SIZE_P),
        y << (zoomStep + Cube.prototype.BUCKET_SIZE_P),
        z << (zoomStep + Cube.prototype.BUCKET_SIZE_P),
      ],
      zoomStep,
      cubeSize: 1 << Cube.prototype.BUCKET_SIZE_P,
    };

    bucket = _.extend(bucket, options);

    return bucket;
  },


  bucketToZoomedAddress(bucket) {
    const [x, y, z] = bucket.position;
    const { zoomStep } = bucket;
    return [
      x >> (zoomStep + Cube.prototype.BUCKET_SIZE_P),
      y >> (zoomStep + Cube.prototype.BUCKET_SIZE_P),
      z >> (zoomStep + Cube.prototype.BUCKET_SIZE_P),
      zoomStep,
    ];
  },

};


export default BucketBuilder;
