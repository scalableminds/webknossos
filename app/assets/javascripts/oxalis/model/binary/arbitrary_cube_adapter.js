/**
 * arbitrary_cube_adapter.js
 * @flow weak
 */

import _ from "lodash";
import Utils from "../../../libs/utils";
import Cube from "oxalis/model/binary/cube";
import type { Vector3 } from "oxalis/constants";

// TODO: This should be refactored into composition instead of inheritance
class BucketData extends Uint8Array {
  zoomStep: number;
  isTemporalData: boolean;
}

class ArbitraryCubeAdapter {

  ARBITRARY_MAX_ZOOMSTEP: number;
  NOT_LOADED_BUCKET_INTENSITY: number;
  cube: Cube;
  boundary: Vector3;
  sizeZYX: number;
  sizeZY: number;
  sizeZ: number;
  NOT_LOADED_BUCKET_DATA: BucketData;
  getBucket: (bucketIndex: number) => ?Uint8Array | number;

  static initClass() {
    this.prototype.ARBITRARY_MAX_ZOOMSTEP = 2;
    this.prototype.NOT_LOADED_BUCKET_INTENSITY = 100;

    this.prototype.getBucket = _.memoize(function (bucketIndex) {
      let bucketAddress = [
        Math.floor(bucketIndex / this.sizeZY),
        Math.floor((bucketIndex % this.sizeZY) / this.sizeZ),
        bucketIndex % this.sizeZ,
        0,
      ];

      for (const zoomStep of Utils.__range__(0, this.ARBITRARY_MAX_ZOOMSTEP, true)) {
        const bucket = this.cube.getBucket(bucketAddress);

        if (bucket.isOutOfBoundingBox) {
          return null;
        }

        if (bucket.hasData()) {
          const bucketData = this.cube.getBucket(bucketAddress).getData();
          bucketData.zoomStep = zoomStep;
          return bucketData;
        }

        bucketAddress = [
          bucketAddress[0] >> 1,
          bucketAddress[1] >> 1,
          bucketAddress[2] >> 1,
          bucketAddress[3] + 1,
        ];
      }

      return this.NOT_LOADED_BUCKET_DATA;
    });
  }


  constructor(cube, boundary) {
    this.cube = cube;
    this.boundary = boundary;
    this.sizeZYX = this.boundary[0] * this.boundary[1] * this.boundary[2];
    this.sizeZY = this.boundary[1] * this.boundary[2];
    this.sizeZ = this.boundary[2];

    this.NOT_LOADED_BUCKET_DATA = new BucketData(this.cube.BUCKET_LENGTH);
    for (const i of Utils.__range__(0, this.NOT_LOADED_BUCKET_DATA.length, false)) {
      this.NOT_LOADED_BUCKET_DATA[i] = this.NOT_LOADED_BUCKET_INTENSITY;
    }
    this.NOT_LOADED_BUCKET_DATA.zoomStep = 0;
    this.NOT_LOADED_BUCKET_DATA.isTemporalData = true;
  }


  isValidBucket(bucketIndex) {
    return bucketIndex < this.sizeZYX;
  }


  reset() {
    return this.getBucket.cache.clear();
  }
}
ArbitraryCubeAdapter.initClass();


export default ArbitraryCubeAdapter;
