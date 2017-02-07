/**
 * arbitrary_cube_adapter.js
 * @flow
 */

import _ from "lodash";
import DataCube from "oxalis/model/binary/data_cube";
import type { Vector3 } from "oxalis/constants";

// TODO: This should be refactored into composition instead of inheritance
// Try to not use this type unless flow forces you to do that because you are
// trying to access "zoomStep" or "isTemporalData" of an Uint8Array.
// When we flowed everything we can refactor all occurences of BucketData into
// composition.
class BucketData extends Uint8Array {
  zoomStep: number;
  isTemporalData: boolean;
}

const ARBITRARY_MAX_ZOOMSTEP = 2;
const NOT_LOADED_BUCKET_INTENSITY = 100;

class ArbitraryCubeAdapter {

  cube: DataCube;
  boundary: Vector3;
  sizeZYX: number;
  sizeZY: number;
  sizeZ: number;
  NOT_LOADED_BUCKET_DATA: BucketData;
  getBucket = _.memoize(this.getBucketImpl);

  constructor(cube: DataCube, boundary: Vector3) {
    this.cube = cube;
    this.boundary = boundary;
    this.sizeZYX = this.boundary[0] * this.boundary[1] * this.boundary[2];
    this.sizeZY = this.boundary[1] * this.boundary[2];
    this.sizeZ = this.boundary[2];

    this.NOT_LOADED_BUCKET_DATA = new BucketData(this.cube.BUCKET_LENGTH);
    for (let i = 0; i < this.NOT_LOADED_BUCKET_DATA.length; i++) {
      this.NOT_LOADED_BUCKET_DATA[i] = NOT_LOADED_BUCKET_INTENSITY;
    }
    this.NOT_LOADED_BUCKET_DATA.zoomStep = 0;
    this.NOT_LOADED_BUCKET_DATA.isTemporalData = true;
  }


  isValidBucket(bucketIndex: number): boolean {
    return bucketIndex < this.sizeZYX;
  }


  reset(): void {
    return this.getBucket.cache.clear();
  }

  getBucketImpl(bucketIndex: number): ?BucketData {
    let bucketAddress = [
      Math.floor(bucketIndex / this.sizeZY),
      Math.floor((bucketIndex % this.sizeZY) / this.sizeZ),
      bucketIndex % this.sizeZ,
      0,
    ];

    for (let zoomStep = 0; zoomStep <= ARBITRARY_MAX_ZOOMSTEP; zoomStep++) {
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
  }
}

export default ArbitraryCubeAdapter;
