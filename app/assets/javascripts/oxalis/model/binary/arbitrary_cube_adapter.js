/**
 * arbitrary_cube_adapter.js
 * @flow
 */

import _ from "lodash";
import type DataCube from "oxalis/model/binary/data_cube";
import type { Vector3 } from "oxalis/constants";

const ARBITRARY_MAX_ZOOMSTEP = 2;
const NOT_LOADED_BUCKET_INTENSITY = 100;

class ArbitraryBucketData {
  data: Uint8Array;
  zoomStep: number = 0;
  isTemporalData: boolean = false;

  static notLoadedBucketData = _.memoize((dataLength: number): ArbitraryBucketData => {
    const bucketData = new ArbitraryBucketData(new Uint8Array(dataLength));
    bucketData.fill(NOT_LOADED_BUCKET_INTENSITY);
    bucketData.zoomStep = 0;
    bucketData.isTemporalData = true;
    return bucketData;
  });

  constructor(data: Uint8Array) {
    this.data = data;
  }

  fill(value: number): void {
    if (this.data.fill != null) {
      this.data.fill(value);
    } else {
      // Polyfill
      for (let i = 0; i < this.data.length; i++) {
        this.data[i] = value;
      }
    }
  }
}

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

  getBucket = _.memoize((bucketIndex: number): ?ArbitraryBucketData => {
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
        const bucketData = new ArbitraryBucketData(this.cube.getBucket(bucketAddress).getData());
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
    return ArbitraryBucketData.notLoadedBucketData(this.cube.BUCKET_LENGTH);
  });
}

export default ArbitraryCubeAdapter;
