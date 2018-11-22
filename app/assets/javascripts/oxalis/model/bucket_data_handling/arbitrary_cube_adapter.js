/**
 * arbitrary_cube_adapter.js
 * @flow
 */

import _ from "lodash";

import {
  DataBucket,
  NULL_BUCKET,
  NULL_BUCKET_OUT_OF_BB,
} from "oxalis/model/bucket_data_handling/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";

const ARBITRARY_MAX_ZOOMSTEP = 2;

class ArbitraryCubeAdapter {
  cube: DataCube;
  boundary: Vector3;
  sizeZYX: number;
  sizeZY: number;
  sizeZ: number;

  constructor(cube: DataCube, boundary: Vector3) {
    this.cube = cube;
    this.boundary = boundary;
    this.sizeZYX = this.boundary[0] * this.boundary[1] * this.boundary[2];
    this.sizeZY = this.boundary[1] * this.boundary[2];
    this.sizeZ = this.boundary[2];
  }

  isValidBucket(bucketIndex: number): boolean {
    return bucketIndex < this.sizeZYX;
  }

  reset(): void {
    return this.getBucket.cache.clear();
  }

  getBucketAddress = (bucketIndex: number): Vector4 => [
    Math.floor(bucketIndex / this.sizeZY),
    Math.floor((bucketIndex % this.sizeZY) / this.sizeZ),
    bucketIndex % this.sizeZ,
    0,
  ];

  getBucket = _.memoize(
    (bucketIndex: number): DataBucket | typeof NULL_BUCKET => {
      let bucketAddress = this.getBucketAddress(bucketIndex);

      for (let zoomStep = 0; zoomStep <= ARBITRARY_MAX_ZOOMSTEP; zoomStep++) {
        const bucket = this.cube.getBucket(bucketAddress);

        if (bucket.isOutOfBoundingBox) {
          return NULL_BUCKET_OUT_OF_BB;
        }

        if (bucket.hasData()) {
          return bucket;
        }

        bucketAddress = [
          bucketAddress[0] >> 1,
          bucketAddress[1] >> 1,
          bucketAddress[2] >> 1,
          bucketAddress[3] + 1,
        ];
      }
      return NULL_BUCKET;
    },
  );
}

export default ArbitraryCubeAdapter;
